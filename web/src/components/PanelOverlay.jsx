import { usePanelModal } from '../hooks/usePanelModal.jsx';
import Modal from './Modal.jsx';
import YourPredictions from './YourPredictions.jsx';
import Creator from '../pages/Creator.jsx';

// The single host for the Your Predictions and Create OVERLAYS (owner decision,
// Oct 2026). App owns which panel is open (usePanelModal); this draws the right
// one inside the shared <Modal> shell so both read exactly like the sign-in box.
// Only one is ever open; mounting a fresh <Creator> per open (via key) resets its
// internal room/prefill state so reopening never shows a stale cockpit.
// The portfolio-modal testId/labelledBy contract is FROZEN (e2e): the panel is
// the same box, only its body and title changed to Your Predictions.
export default function PanelOverlay() {
  const { panel, creator, closePanel } = usePanelModal();
  const creatorKey = `c|${creator?.roomId || 'new'}|${creator?.prefillTitle || ''}|${creator?.prefillChannel || ''}`;
  return (
    <>
      <Modal
        open={panel === 'portfolio'}
        onClose={closePanel}
        testId="portfolio-modal"
        labelledBy="portfolio-modal-title"
        panelClassName="max-w-2xl p-6"
      >
        <YourPredictions />
      </Modal>
      <Modal
        open={panel === 'creator'}
        onClose={closePanel}
        testId="creator-modal"
        labelledBy="creator-modal-title"
        panelClassName="max-w-2xl p-6"
      >
        <Creator
          key={creatorKey}
          roomId={creator?.roomId || null}
          prefillTitle={creator?.prefillTitle || ''}
          prefillChannel={creator?.prefillChannel || ''}
        />
      </Modal>
    </>
  );
}
