import { createApp } from 'vue';
import App from './App.vue';
import './styles/tokens.css';
import './styles/schemes.css';
import './styles/base.css';
import './styles/workbench.css';
import './styles/editor.css';
import './styles/output.css';
import './styles/sheets.css';
import './styles/ide.css';
import './styles/apiEndpoint.css';
import '@xterm/xterm/css/xterm.css';
import './styles/terminal.css';

createApp(App).mount('#app');
