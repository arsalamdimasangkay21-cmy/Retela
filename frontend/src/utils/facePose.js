const RIGHT_EYE = [33, 160, 158, 133, 153, 144];
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const NOSE_TIP = 1;
const CHIN = 152;
const FOREHEAD = 10;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;
const MOUTH_CENTER = 13;
const GUIDE_BOUNDS = { left: 0.17, top: 0.12, right: 0.83, bottom: 0.88 };
const CIRCLE_CENTER = { x: 0.5, y: 0.5 };
const CIRCLE_RADIUS = 0.43;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function distance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

export function eyeAspectRatio(landmarks, indices) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean);
  if (points.length < 6) return 0;
  return (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * Math.max(distance(points[0], points[3]), 0.0001));
}

export function getBlendshapeScore(blendshapes, name) {
  return blendshapes?.categories?.find((category) => category.categoryName === name)?.score || 0;
}

function getBounds(landmarks) {
  return landmarks.reduce((bounds, point) => ({
    left: Math.min(bounds.left, point.x),
    top: Math.min(bounds.top, point.y),
    right: Math.max(bounds.right, point.x),
    bottom: Math.max(bounds.bottom, point.y)
  }), { left: 1, top: 1, right: 0, bottom: 0 });
}

function isInsideCircularCrop(bounds) {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const centerX = bounds.left + width / 2;
  const centerY = bounds.top + height / 2;
  return Math.hypot(centerX - CIRCLE_CENTER.x, centerY - CIRCLE_CENTER.y) <= CIRCLE_RADIUS;
}

function compactValidFaces(faceLandmarks = []) {
  const faces = faceLandmarks
    .map((landmarks, resultIndex) => {
      const bounds = getBounds(landmarks);
      const width = bounds.right - bounds.left;
      const height = bounds.bottom - bounds.top;
      const faceRatio = Math.max(width, height);
      return {
        landmarks,
        resultIndex,
        bounds,
        faceRatio,
        area: width * height,
        centerX: bounds.left + width / 2,
        centerY: bounds.top + height / 2
      };
    })
    .filter((face) => face.faceRatio >= 0.16 && face.area >= 0.018 && isInsideCircularCrop(face.bounds))
    .sort((a, b) => b.area - a.area);

  return faces.reduce((unique, face) => {
    const duplicate = unique.some((existing) => (
      Math.hypot(face.centerX - existing.centerX, face.centerY - existing.centerY) < 0.08
    ));
    if (!duplicate) unique.push(face);
    return unique;
  }, []);
}

function poseFromMatrix(matrix) {
  const data = matrix?.data;
  if (!data || data.length < 16) return null;
  const m00 = data[0];
  const m01 = data[1];
  const m02 = data[2];
  const m10 = data[4];
  const m11 = data[5];
  const m12 = data[6];
  const m20 = data[8];
  const m21 = data[9];
  const m22 = data[10];
  const yaw = -Math.atan2(m02, m22) * 180 / Math.PI;
  const pitch = Math.atan2(-m21, Math.sqrt((m20 * m20) + (m22 * m22))) * 180 / Math.PI;
  const roll = Math.atan2(m10, m11) * 180 / Math.PI;
  return { yaw, pitch, roll, matrixConfidence: Math.abs(m00) + Math.abs(m11) + Math.abs(m22) };
}

function poseFromLandmarks(landmarks, bounds) {
  const nose = landmarks[NOSE_TIP];
  const chin = landmarks[CHIN];
  const forehead = landmarks[FOREHEAD];
  const leftCheek = landmarks[LEFT_CHEEK];
  const rightCheek = landmarks[RIGHT_CHEEK];
  const mouth = landmarks[MOUTH_CENTER];
  const width = Math.max(bounds.right - bounds.left, 0.0001);
  const height = Math.max(bounds.bottom - bounds.top, 0.0001);
  const cheekMidX = ((leftCheek?.x || 0) + (rightCheek?.x || 0)) / 2;
  const yaw = -((nose?.x || cheekMidX) - cheekMidX) / width * 95;
  const verticalAnchor = (((forehead?.y || bounds.top) + (mouth?.y || bounds.bottom)) / 2);
  const pitch = (verticalAnchor - (nose?.y || verticalAnchor)) / height * 70;
  const roll = Math.atan2((rightCheek?.y || 0) - (leftCheek?.y || 0), (rightCheek?.x || 1) - (leftCheek?.x || 0)) * 180 / Math.PI;
  if (!chin || !forehead || !nose) return { yaw, pitch, roll, matrixConfidence: 0 };
  return { yaw, pitch, roll, matrixConfidence: 0 };
}

export function readFrameQuality(video, canvas) {
  const width = 64;
  const height = 48;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const gray = new Array(width * height);
  let brightness = 0;

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    gray[pixel] = luminance;
    brightness += luminance;
  }

  brightness /= gray.length;

  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      edgeTotal += Math.abs((gray[index] * 4) - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width]);
      edgeCount += 1;
    }
  }

  return { brightness, blurScore: edgeTotal / Math.max(edgeCount, 1) };
}

export function buildFacePose(result, video, canvas, previous = null) {
  const validFaces = compactValidFaces(result?.faceLandmarks || []);
  const faceCount = validFaces.length;
  if (faceCount !== 1) return { faceCount };

  const primaryFace = validFaces[0];
  const landmarks = primaryFace.landmarks;
  const blendshapes = result.faceBlendshapes?.[primaryFace.resultIndex];
  const matrix = result.facialTransformationMatrixes?.[primaryFace.resultIndex];
  const bounds = primaryFace.bounds;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const centerX = primaryFace.centerX;
  const centerY = primaryFace.centerY;
  const pose = poseFromMatrix(matrix) || poseFromLandmarks(landmarks, bounds);
  const leftEar = eyeAspectRatio(landmarks, LEFT_EYE);
  const rightEar = eyeAspectRatio(landmarks, RIGHT_EYE);
  const averageEar = (leftEar + rightEar) / 2;
  const leftBlink = getBlendshapeScore(blendshapes, "eyeBlinkLeft");
  const rightBlink = getBlendshapeScore(blendshapes, "eyeBlinkRight");
  const frame = readFrameQuality(video, canvas);
  const now = performance.now();
  const movement = previous?.time
    ? Math.hypot(centerX - previous.centerX, centerY - previous.centerY) / Math.max((now - previous.time) / 1000, 0.1)
    : 0;
  const insideGuide = centerX >= GUIDE_BOUNDS.left && centerX <= GUIDE_BOUNDS.right && centerY >= GUIDE_BOUNDS.top && centerY <= GUIDE_BOUNDS.bottom && isInsideCircularCrop(bounds);
  const centered = Math.abs(centerX - 0.5) <= 0.13 && Math.abs(centerY - 0.5) <= 0.15;
  const faceRatio = primaryFace.faceRatio;

  return {
    faceCount,
    landmarks,
    bounds,
    centerX,
    centerY,
    faceWidthRatio: width,
    faceRatio,
    insideGuide,
    centered,
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    leftEar,
    rightEar,
    averageEar,
    leftBlink,
    rightBlink,
    blinkScore: Math.max(leftBlink, rightBlink),
    bothBlinkScore: Math.min(leftBlink || 0, rightBlink || 0),
    brightness: frame.brightness,
    blurScore: frame.blurScore,
    movement,
    tooFar: width < 0.3,
    tooClose: width > 0.78,
    dark: frame.brightness < 42,
    blurry: frame.blurScore < 4,
    movingTooFast: movement > 0.42,
    partiallyOutside: bounds.left < 0.02 || bounds.top < 0.02 || bounds.right > 0.98 || bounds.bottom > 0.98,
    eyesVisible: leftEar > 0.08 && rightEar > 0.08,
    time: now
  };
}
