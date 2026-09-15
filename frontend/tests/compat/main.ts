import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import ComponentFixture from './ComponentFixture.vue';

// Test-only Vite HTML entry, absent from the production build input/router.
createApp(ComponentFixture).use(ElementPlus).mount('#app');
