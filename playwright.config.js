import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'ui.spec.js',use:{baseURL:'http://127.0.0.1:5173',headless:true,channel:'msedge'},webServer:{command:'npm run dev',url:'http://127.0.0.1:5173',reuseExistingServer:true}});
