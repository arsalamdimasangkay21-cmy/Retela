import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useEffect, useState } from "react";

const WASM_BASE_URL = "/mediapipe/wasm";
const FACE_LANDMARKER_MODEL_URL = "/models/face_landmarker.task";
const INIT_TIMEOUT_MS = 8000;

let faceLandmarkerPromise;

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error("Face verification could not start. Tap to retry.")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function createLandmarker(vision, delegate) {
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: FACE_LANDMARKER_MODEL_URL,
      delegate
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.55,
    minFacePresenceConfidence: 0.55,
    minTrackingConfidence: 0.5
  });
}

export function getFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = withTimeout(
      FilesetResolver.forVisionTasks(WASM_BASE_URL).then((vision) => (
        createLandmarker(vision, "GPU").catch((gpuError) => {
          console.warn("MediaPipe GPU initialization failed; retrying with CPU.", gpuError);
          return createLandmarker(vision, "CPU");
        })
      )),
      INIT_TIMEOUT_MS
    ).catch((error) => {
      console.error("MediaPipe FaceLandmarker initialization failed.", error);
      faceLandmarkerPromise = null;
      throw error;
    });
  }
  return faceLandmarkerPromise;
}

export function useFaceLandmarker() {
  const [state, setState] = useState({ landmarker: null, loading: true, error: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getFaceLandmarker()
      .then((landmarker) => {
        if (active) setState({ landmarker, loading: false, error: "" });
      })
      .catch((error) => {
        if (active) setState({ landmarker: null, loading: false, error: error?.message || "Face verification could not start. Tap to retry." });
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return {
    ...state,
    retry: () => {
      faceLandmarkerPromise = null;
      setState({ landmarker: null, loading: true, error: "" });
      setAttempt((value) => value + 1);
    }
  };
}
