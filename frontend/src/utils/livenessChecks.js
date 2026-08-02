import { clamp } from "./facePose";

export const LIVENESS_STEPS = {
  CENTER: "CENTER",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
  UP: "UP",
  BLINK: "BLINK"
};

export const STEP_LABELS = {
  CENTER: "Position your face inside the circle",
  LEFT: "Slowly turn left",
  RIGHT: "Slowly turn right",
  UP: "Look slightly upward",
  BLINK: "Blink once"
};

export function createLivenessSequence() {
  const actions = [LIVENESS_STEPS.LEFT, LIVENESS_STEPS.RIGHT, LIVENESS_STEPS.UP, LIVENESS_STEPS.BLINK];
  for (let index = actions.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [actions[index], actions[swap]] = [actions[swap], actions[index]];
  }
  return [LIVENESS_STEPS.CENTER, ...actions];
}

export function baseInstruction(face) {
  if (!face || face.faceCount === 0) return "Position your face inside the circle";
  if (face.faceCount > 1) return "Only one person should be visible";
  if (face.dark) return "Improve the lighting";
  if (face.tooFar) return "Move closer";
  if (face.tooClose) return "Move slightly farther away";
  if (!face.insideGuide || !face.centered) return "Center your face";
  if (face.blurry || face.movingTooFast) return "Hold still";
  return "";
}

export function isBaseFaceValid(face) {
  return Boolean(
    face &&
    face.faceCount === 1 &&
    face.insideGuide &&
    face.centered &&
    !face.tooFar &&
    !face.tooClose &&
    !face.dark &&
    !face.blurry &&
    !face.movingTooFast &&
    !face.partiallyOutside &&
    face.eyesVisible
  );
}

export function movementProgress(step, face, neutralPose, blink) {
  if (!face) return 0;
  const yawDelta = face.yaw - (neutralPose?.yaw || 0);
  const pitchDelta = face.pitch - (neutralPose?.pitch || 0);
  if (step === LIVENESS_STEPS.CENTER) return isBaseFaceValid(face) ? 1 : 0;
  if (step === LIVENESS_STEPS.LEFT) return clamp(Math.abs(Math.min(yawDelta, 0)) / 18, 0, 1);
  if (step === LIVENESS_STEPS.RIGHT) return clamp(Math.max(yawDelta, 0) / 18, 0, 1);
  if (step === LIVENESS_STEPS.UP) return clamp(Math.abs(Math.min(pitchDelta, 0)) / 10, 0, 1);
  if (step === LIVENESS_STEPS.BLINK) return blink?.detected ? 1 : blink?.progress || 0;
  return 0;
}

export function isStepSatisfied(step, face, neutralPose, blink) {
  if (!isBaseFaceValid(face)) return false;
  const yawDelta = face.yaw - (neutralPose?.yaw || 0);
  const pitchDelta = face.pitch - (neutralPose?.pitch || 0);
  if (step === LIVENESS_STEPS.CENTER) return Math.abs(face.yaw) <= 12 && Math.abs(face.pitch) <= 12 && Math.abs(face.roll) <= 12;
  if (step === LIVENESS_STEPS.LEFT) return yawDelta <= -15 && yawDelta >= -32;
  if (step === LIVENESS_STEPS.RIGHT) return yawDelta >= 15 && yawDelta <= 32;
  if (step === LIVENESS_STEPS.UP) return pitchDelta <= -8 && pitchDelta >= -24;
  if (step === LIVENESS_STEPS.BLINK) return Boolean(blink?.detected);
  return false;
}

