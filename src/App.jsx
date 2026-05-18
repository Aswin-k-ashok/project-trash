import BinMap from './components/BinMap';

function App() {
  return (
    <main className="app-shell">
      <div className="app-glow app-glow--one" aria-hidden="true"></div>
      <div className="app-glow app-glow--two" aria-hidden="true"></div>

      <section className="hero-panel">
        <div className="hero-copy-block">
          <p className="eyebrow">Waste Bin Locator</p>
          <h1>Find the nearest bin without breaking your stride.</h1>
          {/* <p className="hero-copy">
            A softer, cleaner map experience for locating bins, adding new ones,
            and sharing quick feedback as the app grows.
          </p> */}
        </div>

        {/* <div className="hero-metrics" aria-label="App highlights">
          <article className="metric-card">
            <span className="metric-card__label">Map-first</span>
            <strong>Fast local bin spotting</strong>
          </article>
          <article className="metric-card">
            <span className="metric-card__label">Community-led</span>
            <strong>Add public and private bins</strong>
          </article>
          <article className="metric-card">
            <span className="metric-card__label">Feedback-ready</span>
            <strong>Suggest improvements in-app</strong>
          </article>
        </div> */}
      </section>

      <section className="map-scroll-stage">
        <div className="map-card map-card--overlay">
          <div className="map-card__header">
            <div>
              <p className="map-card__eyebrow">Live Map</p>
              <h2>Bin discovery, reporting, and community feedback</h2>
            </div>
            <p className="map-card__summary">
              Explore nearby bins, add a new one in seconds, and keep the map
              improving over time.
            </p>
          </div>
          <BinMap />
        </div>
      </section>
    </main>
  );
}

export default App;
