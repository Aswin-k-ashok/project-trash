import BinMap from './components/BinMap';

function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Waste Bin Locator</p>
        <h1>Where Trash Finds Its Home</h1>
        <p className="hero-copy">
          Because apparently throwing it anywhere else was working too well.
         We mapped them out so you don’t have to pretend you didn’t see one🧠.
        </p>
      </section>

      <section className="map-card">
        <BinMap />
      </section>
    </main>
  );
}

export default App;
