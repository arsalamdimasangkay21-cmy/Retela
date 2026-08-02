import { useEffect, useRef, useState } from "react";
import * as faceapi from "face-api.js";
import { CheckCircle2, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "../ui";

const MODEL_URL = "/models/face-api";
export const FACE_MATCH_DISTANCE_THRESHOLD = 0.6;
const DESCRIPTOR_RETRY_LIMIT = 3;
let modelPromise;
const descriptorCache = new WeakMap();

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

async function detectSingleDescriptor(file, label, { cache = false } = {}) {
  if (cache && descriptorCache.has(file)) return descriptorCache.get(file);

  let lastError;
  for (let attempt = 1; attempt <= DESCRIPTOR_RETRY_LIMIT; attempt += 1) {
    const faces = await detectFacesInImage(file);
    if (faces.length === 1) {
      const result = faces[0];
      if (cache) descriptorCache.set(file, result);
      return result;
    }

    lastError = new Error(faces.length > 1 ? `Multiple faces detected in ${label}.` : `No face detected in ${label}.`);
    if (faces.length > 1) break;
    await new Promise((resolve) => window.setTimeout(resolve, 180 * attempt));
  }

  throw lastError || new Error(`Descriptor generation failed for ${label}.`);
}

export async function compareVerificationFaces(idImage, selfieImage, threshold = FACE_MATCH_DISTANCE_THRESHOLD) {
  const idFace = await detectSingleDescriptor(idImage, "government ID image", { cache: true });
  const selfieFace = await detectSingleDescriptor(selfieImage, "selfie");
  const distance = faceapi.euclideanDistance(idFace.descriptor, selfieFace.descriptor);
  const score = Math.round(Math.max(0, Math.min(100, (1 - distance) * 100)));
  return {
    distance,
    matched: distance <= threshold,
    score,
    threshold
  };
}

export default function FaceRecognition({ idImage, selfieImage, onPassed, onRetry }) {
  const passedRef = useRef(false);
  const [state, setState] = useState({ loading: true, score: 0, distance: null, matched: false, error: "" });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setState({ loading: true, score: 0, distance: null, matched: false, error: "" });
      try {
        const result = await compareVerificationFaces(idImage, selfieImage);
        if (cancelled) return;
        setState({ loading: false, score: result.score, distance: result.distance, matched: result.matched, error: "" });
        if (result.matched && !passedRef.current) {
          passedRef.current = true;
          onPassed(result.score);
        }
      } catch (error) {
        if (!cancelled) setState({ loading: false, score: 0, distance: null, matched: false, error: error.message || "Face verification failed." });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [idImage, selfieImage, onPassed]);

  const passed = state.matched;

  return (
    <div className="retela-face-panel">
      {state.loading ? (
        <>
          <Loader2 className="animate-spin text-emerald-600" size={42} />
          <div>
            <h3 className="font-display text-xl font-bold text-slate-900">Comparing faces</h3>
            <p className="mt-1 text-sm text-slate-500">Verifying your face...</p>
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
