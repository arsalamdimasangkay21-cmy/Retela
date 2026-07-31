import { useEffect, useState } from "react";
import * as faceapi from "face-api.js";
import { CheckCircle2, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "../ui";

const MODEL_URL = "/models/face-api";
let modelPromise;

export function loadFaceModels() {
  modelPromise ||= Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  return modelPromise;
}

export async function detectFacesInImage(file) {
  await loadFaceModels();
  const image = await faceapi.bufferToImage(file);
  return faceapi
    .detectAllFaces(image, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
}

export async function compareVerificationFaces(idImage, selfieImage) {
  const [idFaces, selfieFaces] = await Promise.all([
    detectFacesInImage(idImage),
    detectFacesInImage(selfieImage)
  ]);
  if (idFaces.length !== 1) throw new Error(idFaces.length > 1 ? "Multiple faces detected in government ID image." : "No face detected in government ID image.");
  if (selfieFaces.length !== 1) throw new Error(selfieFaces.length > 1 ? "Multiple faces detected in selfie." : "No face detected in selfie.");
  const distance = faceapi.euclideanDistance(idFaces[0].descriptor, selfieFaces[0].descriptor);
  const score = Math.max(0, Math.min(100, (1 - distance) * 100));
  return Math.round(score);
}

export default function FaceRecognition({ idImage, selfieImage, onPassed, onRetry }) {
  const [state, setState] = useState({ loading: true, score: 0, error: "" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setState({ loading: true, score: 0, error: "" });
      try {
        const score = await compareVerificationFaces(idImage, selfieImage);
        if (cancelled) return;
        setState({ loading: false, score, error: "" });
        if (score >= 80) onPassed(score);
      } catch (error) {
        if (!cancelled) setState({ loading: false, score: 0, error: error.message || "Face verification failed." });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [idImage, selfieImage, onPassed]);

  const passed = state.score >= 80;

  return (
    <div className="retela-face-panel">
      {state.loading ? (
        <>
          <Loader2 className="animate-spin text-emerald-600" size={42} />
          <div>
            <h3 className="font-display text-xl font-bold text-slate-900">Comparing faces</h3>
            <p className="mt-1 text-sm text-slate-500">RETELA is matching the government ID and selfie.</p>
          </div>
        </>
      ) : passed ? (
        <>
          <CheckCircle2 className="text-emerald-600" size={46} />
          <div>
            <h3 className="font-display text-xl font-bold text-slate-900">Verification Passed</h3>
            <p className="mt-1 text-sm text-slate-500">Face matched. Continue to Gmail OTP.</p>
          </div>
        </>
      ) : (
        <>
          <ShieldAlert className="text-rose-600" size={46} />
          <div>
            <h3 className="font-display text-xl font-bold text-slate-900">Retry verification</h3>
            <p className="mt-1 text-sm text-slate-500">{state.error || "Face did not match. Retake a clear selfie."}</p>
          </div>
          <Button type="button" variant="secondary" onClick={onRetry}><RotateCcw size={16} /> Retry</Button>
        </>
      )}
    </div>
  );
}
