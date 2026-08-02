import FaceVerification from "../FaceVerification";

export default function SelfieCaptureStep({ selfie, selfiePreview, livenessVerified = false, onCaptured, onBack, onNext }) {
  return (
    <FaceVerification
      selfie={selfie}
      selfiePreview={selfiePreview}
      livenessVerified={livenessVerified}
      onCaptured={onCaptured}
      onBack={onBack}
      onNext={onNext}
    />
  );
}
