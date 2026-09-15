import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './app/App.vue';
import { router } from './app/router';
import 'element-plus/es/components/button/style/css';
import './styles/global.css';

createApp(App).use(createPinia()).use(router).mount('#app');
