import { Component } from 'react';

/**
 * Keeps one screen's crash from blanking the whole app (review H6).
 * The triage in progress is autosaved (lib/triageDraft), so reloading brings it back.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No patient data in the log: the error message and the component stack only.
    console.error('[screen error]', error?.message, info?.componentStack?.split('\n').slice(0, 4).join(' | '));
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div dir="rtl" role="alert" className="tp-card max-w-lg mx-auto my-10 p-6 flex flex-col gap-3 text-center">
        <p className="text-lg font-bold text-ink">حدث خطأ في هذه الشاشة</p>
        <p className="text-base text-ink" dir="ltr">Something went wrong on this screen.</p>
        <p className="text-sm text-graphite">
          الفرز الجاري محفوظ تلقائياً وسيعود بعد إعادة التحميل · The triage in progress is saved and comes back after reload.
        </p>
        <div className="flex gap-2 justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-ink text-paper px-4 py-2 font-semibold"
          >
            إعادة التحميل · Reload
          </button>
          <button
            type="button"
            onClick={() => { this.setState({ error: null }); window.history.back(); }}
            className="rounded-xl border border-mist px-4 py-2 font-semibold text-ink"
          >
            رجوع · Back
          </button>
        </div>
      </div>
    );
  }
}
