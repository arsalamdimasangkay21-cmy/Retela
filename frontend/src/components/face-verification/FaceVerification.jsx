import { useState } from "react";
import FaceVerificationIntro from "./FaceVerificationIntro";
import CircularFaceScanner from "./CircularFaceScanner";
import "../../styles/face-verification.css";

export default function FaceVerification(props) {
  const { selfiePreview, livenessVerified, onBack } = props;
  const [started, setStarted] = useState(Boolean(selfiePreview && livenessVerified));

  if (!started && !(selfiePreview && livenessVerified)) {
    return (
      <FaceVerificationIntro
        onStart={() => setStarted(true)}
        onCancel={onBack}
      />
    );
  }

  return <CircularFaceScanner {...props} />;
}
