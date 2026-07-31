import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
          <section className="max-w-lg rounded-2xl bg-white p-6 shadow-float">
            <p className="font-display text-sm font-semibold text-bluebrand">Retela runtime error</p>
            <h1 className="mt-2 font-display text-2xl font-bold">The app could not render.</h1>
            <p className="mt-3 text-sm text-slate-600">{this.state.error.message}</p>
            <button
              className="gradient-btn mt-5 rounded-xl px-4 py-2 text-sm font-semibold"
              onClick={() => {
                localStorage.removeItem("retela_user");
                localStorage.removeItem("retela_token");
                window.location.reload();
              }}
            >
              Clear session and reload
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
