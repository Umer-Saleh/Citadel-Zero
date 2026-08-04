import { Paladin } from './components/Paladin';
import { useTheme } from './context/ThemeContext';

export default function App() {
  const { toggle, theme } = useTheme();

  const poses = ['idle', 'channel', 'gate', 'oath', 'guard', 'levelup', 'smithIdle', 'brace', 'deflect'];

  return (
    <div style={{ padding: 40 }}>
      <button onClick={toggle} style={{ marginBottom: 24 }}>Theme: {theme}</button>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {poses.map(p => (
          <div key={p} style={{ textAlign: 'center' }}>
            <Paladin pose={p} size={96} ring={p === 'channel' ? 0.6 : null} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{p}</div>
          </div>
        ))}
      </div>
    </div>
  );
}