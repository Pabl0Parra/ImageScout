import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { initialTheme, applyTheme } from './theme';

applyTheme(initialTheme());
createRoot(document.getElementById('root')).render(<App />);
