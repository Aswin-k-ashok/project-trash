import BinMap from './components/BinMap';

// The whole app is the map: it fills the screen, with the top bar, controls
// and bottom sheet floating over it (see BinMap).
function App() {
  return (
    <main className="app">
      <BinMap />
    </main>
  );
}

export default App;
