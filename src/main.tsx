import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from 'react-aria-components';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><I18nProvider locale="ru-RU"><App /></I18nProvider></StrictMode>);
