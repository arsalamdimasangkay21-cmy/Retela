import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { useEffect, useState } from "react";

const MEDIAPIPE_VERSION = "1.0.1";
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_LANDMARKER_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";

let faceLandmarkerPromise;

export function getFaceLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE_URL).then((vision) => (
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55
      }).catch(() => FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55
      }))
    )).catch((error) => {
      faceLandmarkerPromise = null;
      throw error;
    });
  }
  return faceLandmarkerPromise;
}

export function useFaceLandmarker() {
  const [state, setState] = useState({ landmarker: null, loading: true, error: "" });

  useEffect(() => {
    let active = true;
    getFaceLandmarker()
      .then((landmarker) => {
        if (active) setState({ landmarker, loading: false, error: "" });
      })
      .catch((error) => {
        if (active) setState({ landmarker: null, loading: false, error: error?.message || "Face model failed to load." });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
