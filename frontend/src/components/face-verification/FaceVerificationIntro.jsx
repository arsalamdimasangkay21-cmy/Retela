import { ArrowLeft, ScanFace, ShieldCheck } from "lucide-react";
import { Button } from "../ui";
import SegmentedProgressRing from "./SegmentedProgressRing";

export default function FaceVerificationIntro({ onStart, onCancel }) {
  return (
    <div className="retela-face-scan-shell retela-face-scan-intro">
      <header className="retela-face-scan-topbar">
        <button type="button" className="retela-face-scan-text-button" onClick={onCancel} aria-label="Go back">
          <ArrowLeft size={20} />
          <span>Back</span>
        </button>
        <div className="retela-face-scan-secure">
          <ShieldCheck size={15} />
          <span>Secure</span>
        </div>
      </header>

      <main className="retela-face-scan-intro-main">
        <div className="retela-face-scan-intro-art" aria-hidden="true">
          <SegmentedProgressRing progress={0.36} currentTargetProgress={0.38} />
          <div className="retela-face-scan-intro-icon">
            <ScanFace size={74} />
          </div>
        </div>

        <section className="retela-face-scan-copy">
          <p className="retela-face-scan-step">Step 2 of 5</p>
          <h1>Set Up Face Verification</h1>
          <p>
            Position your face inside the frame, then slowly move your head in a circle to show different angles of your face.
          </p>
        </section>
      </main>

      <footer className="retela-face-scan-footer">
        <Button type="button" className="retela-face-scan-primary" onClick={onStart}>
          Get Started
        </Button>
      </footer>
    </div>
  );
}
