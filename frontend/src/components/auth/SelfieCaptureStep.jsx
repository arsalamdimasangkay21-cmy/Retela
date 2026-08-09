import FaceVerification from "../FaceVerification";

export default function SelfieCaptureStep({ selfie, selfiePreview, captureVerified = false, onCaptured, onBack, onNext }) {
  return (
    <FaceVerification
      selfie={selfie}
      selfiePreview={selfiePreview}
      captureVerified={captureVerified}
      onCaptured={onCaptured}
      onBack={onBack}
      onNext={onNext}
    />
  );
}
