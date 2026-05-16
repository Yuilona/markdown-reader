import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// PR-6 ordering: fonts → light vars → dark vars → transitions → global.
// CSS specificity ties go to the LAST rule, so:
//   - dark vars come after light so `[data-theme='dark']` overrides win
//     over the `:root` light defaults (light vars set both `:root` AND
//     `:root[data-theme='light']` for explicit-mode wins; dark only
//     hits when `[data-theme='dark']`).
//   - global.css comes last so the layout reset / app-root rules see the
//     CSS variables already defined.
// PR-8: print.css imported LAST so its @media print rules override the
// screen-only rules above. The rules are gated by @media print so they
// have zero effect outside of a print dialog / preview.
import './styles/fonts.css';
import './styles/theme.light.css';
import './styles/theme.dark.css';
import './styles/transitions.css';
import './styles/global.css';
import './styles/print.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
