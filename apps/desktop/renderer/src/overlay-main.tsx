import { createRoot } from 'react-dom/client';
import Overlay from './overlay';
import './tokens.css';
import './overlay.css';

createRoot(document.getElementById('root') as HTMLElement).render(<Overlay />);
