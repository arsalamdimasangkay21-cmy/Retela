import { clamp } from "./facePose";

export const SCAN_REGION_HOLD_MS = 140;
export const CENTER_HOLD_MS = 520;
export const STEP_TIMEOUT_MS = 8000;
export const FACE_MISSING_RESET_MS = 1500;
export const MULTIPLE_FACE_CONSECUTIVE_FRAMES = 10;
export const DETECTION_INTERVAL_MS = 55;

export const CIRCULAR_SCAN_ROUTE = [
  "CENTER",
  "LEFT",
  "UPPER_LEFT",
  "UP",
  "UPPER_RIGHT",
  "RIGHT",
  "LOWER_RIGHT",
  "DOWN",
  "LOWER_LEFT",
  "RETURN_CENTER"
];

export const TARGET_LABELS = {
  CENTER: "Position your face inside the circle",
  LEFT: "Move your head slowly to complete the circle",
  UPPER_LEFT: "Keep going",
  UP: "Move a little higher",
  UPPER_RIGHT: "Keep going",
  RIGHT: "Keep going",
  LOWER_RIGHT: "Move a little lower",
  DOWN: "Move a little lower",
  LOWER_LEFT: "Almost done",
  RETURN_CENTER: "Return to the center"
};

export const SCAN_THRESHOLDS = {
  yawMin: 13,
  yawMax: 32,
  pitchMin: 11,
  pitchMax: 26,
  diagonalYawMin: 10,
  diagonalPitchMin: 8,
  centeredYaw: 10,
  centeredPitch: 10,
  centerTolerance: 0.18
};

export function createScanState() {
  return {
    route: CIRCULAR_SCAN_ROUTE,
    index: 0,
    completed: new Set(),
    targetValidSince: 0,
    stepStartedAt: performance.now(),
    retryCount: 0,
    neutralPose: null,
    blinkDetected: false,
    staticFrames: 0,
    capturedAngles: []
  };
}

export function instructionForFace(face, showMultipleFaces = false) {
  if (showMultipleFaces) return "Only one person should be visible";
  if (!face || face.faceCount < 1) return "Position your face inside the circle";
  if (face.dark) return "Improve the lighting";
  if (face.tooFar) return "Move closer";
  if (face.tooClose) return "Move slightly farther away";
  if (!face.centered || !face.insideGuide) return "Center your face";
  if (face.movingTooFast) return "Move your head more slowly";
  if (face.blurry) return "Hold still";
  return "";
}

export function isFaceUsableForScan(face) {
  return Boolean(
    face &&
    face.faceCount === 1 &&
    face.centered &&
    face.insideGuide &&
    !face.tooFar &&
    !face.tooClose &&
    !face.dark &&
    !face.blurry &&
    !face.movingTooFast &&
    !face.partiallyOutside &&
    face.eyesVisible
  );
}

export function targetInstruction(target, progress) {
  if (target === "CENTER") return TARGET_LABELS.CENTER;
  if (target === "RETURN_CENTER") return progress > 0.8 ? "Almost done" : TARGET_LABELS.RETURN_CENTER;
  if (progress > 0.86) return "Almost done";
  return TARGET_LABELS[target] || "Move your head slowly to complete the circle";
}

export function getPoseDelta(face, neutralPose) {
  return {
    yaw: face.yaw - (neutralPose?.yaw || 0),
    pitch: face.pitch - (neutralPose?.pitch || 0),
    roll: face.roll - (neutralPose?.roll || 0)
  };
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

export function regionScore(target, face, neutralPose) {
  if (!face) return 0;
  const delta = getPoseDelta(face, neutralPose);
  const absYaw = Math.abs(delta.yaw);
  const absPitch = Math.abs(delta.pitch);

  if (target === "CENTER" || target === "RETURN_CENTER") {
    const yawScore = 1 - clamp(absYaw / SCAN_THRESHOLDS.centeredYaw, 0, 1);
    const pitchScore = 1 - clamp(absPitch / SCAN_THRESHOLDS.centeredPitch, 0, 1);
    return Math.min(yawScore, pitchScore);
  }

  if (target === "LEFT") return clamp((-delta.yaw - SCAN_THRESHOLDS.yawMin) / 8, 0, 1);
  if (target === "RIGHT") return clamp((delta.yaw - SCAN_THRESHOLDS.yawMin) / 8, 0, 1);
  if (target === "UP") return clamp((-delta.pitch - SCAN_THRESHOLDS.pitchMin) / 7, 0, 1);
  if (target === "DOWN") return clamp((delta.pitch - SCAN_THRESHOLDS.pitchMin) / 7, 0, 1);

  if (target === "UPPER_LEFT") {
    return Math.min(
      clamp((-delta.yaw - SCAN_THRESHOLDS.diagonalYawMin) / 7, 0, 1),
      clamp((-delta.pitch - SCAN_THRESHOLDS.diagonalPitchMin) / 6, 0, 1)
    );
  }
  if (target === "UPPER_RIGHT") {
    return Math.min(
      clamp((delta.yaw - SCAN_THRESHOLDS.diagonalYawMin) / 7, 0, 1),
      clamp((-delta.pitch - SCAN_THRESHOLDS.diagonalPitchMin) / 6, 0, 1)
    );
  }
  if (target === "LOWER_RIGHT") {
    return Math.min(
      clamp((delta.yaw - SCAN_THRESHOLDS.diagonalYawMin) / 7, 0, 1),
      clamp((delta.pitch - SCAN_THRESHOLDS.diagonalPitchMin) / 6, 0, 1)
    );
  }
  if (target === "LOWER_LEFT") {
    return Math.min(
      clamp((-delta.yaw - SCAN_THRESHOLDS.diagonalYawMin) / 7, 0, 1),
      clamp((delta.pitch - SCAN_THRESHOLDS.diagonalPitchMin) / 6, 0, 1)
    );
  }

  return 0;
}

export function isRegionSatisfied(target, face, neutralPose) {
  if (!isFaceUsableForScan(face)) return false;
  const delta = getPoseDelta(face, neutralPose);
  const absYaw = Math.abs(delta.yaw);
  const absPitch = Math.abs(delta.pitch);

  if (target === "CENTER" || target === "RETURN_CENTER") {
    return absYaw <= SCAN_THRESHOLDS.centeredYaw && absPitch <= SCAN_THRESHOLDS.centeredPitch && Math.abs(delta.roll) <= 12;
  }
  if (target === "LEFT") return inRange(delta.yaw, -SCAN_THRESHOLDS.yawMax, -SCAN_THRESHOLDS.yawMin);
  if (target === "RIGHT") return inRange(delta.yaw, SCAN_THRESHOLDS.yawMin, SCAN_THRESHOLDS.yawMax);
  if (target === "UP") return inRange(delta.pitch, -SCAN_THRESHOLDS.pitchMax, -SCAN_THRESHOLDS.pitchMin);
  if (target === "DOWN") return inRange(delta.pitch, SCAN_THRESHOLDS.pitchMin, SCAN_THRESHOLDS.pitchMax);
  if (target === "UPPER_LEFT") return delta.yaw <= -SCAN_THRESHOLDS.diagonalYawMin && delta.pitch <= -SCAN_THRESHOLDS.diagonalPitchMin;
  if (target === "UPPER_RIGHT") return delta.yaw >= SCAN_THRESHOLDS.diagonalYawMin && delta.pitch <= -SCAN_THRESHOLDS.diagonalPitchMin;
  if (target === "LOWER_RIGHT") return delta.yaw >= SCAN_THRESHOLDS.diagonalYawMin && delta.pitch >= SCAN_THRESHOLDS.diagonalPitchMin;
  if (target === "LOWER_LEFT") return delta.yaw <= -SCAN_THRESHOLDS.diagonalYawMin && delta.pitch >= SCAN_THRESHOLDS.diagonalPitchMin;
  return false;
}

export function scanProgress(completedCount, currentScore) {
  return clamp((completedCount + currentScore) / CIRCULAR_SCAN_ROUTE.length, 0, 1);
}
