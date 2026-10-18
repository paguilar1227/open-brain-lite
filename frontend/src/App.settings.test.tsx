import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
vi.mock('./lib/useProjects',()=>({useProjects:()=>({data:[]})}));
vi.mock('./lib/useIsMobile',()=>({useIsMobile:()=>false}));
vi.mock('./components/Sidebar',()=>({Sidebar:({onRoute}:any)=><button onClick={()=>onRoute({route:'settings'})}>Settings</button>}));
vi.mock('./pages/HomePage',()=>({HomePage:()=> <h1>Workspace home</h1>}));
vi.mock('./pages/SettingsPage',()=>({SettingsPage:({onBack}:any)=><section><h1>Settings page</h1><button onClick={onBack}>Back to workspace</button></section>}));
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/');});
afterEach(cleanup);
it('opens settings as a page with its own URL and restores the prior route on Back',async()=>{
  render(<App/>);expect(screen.getByRole('heading',{name:'Workspace home'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Settings'}));
  expect(window.location.pathname).toBe('/settings');
  expect(screen.getByRole('heading',{name:'Settings page'})).toBeTruthy();
  expect(screen.queryByRole('heading',{name:'Workspace home'})).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Back to workspace'}));
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Workspace home'})).toBeTruthy());
  expect(window.location.pathname).toBe('/');
});
it('loads directly at /settings and offers a path back to the workspace',()=>{
  window.history.replaceState(null,'','/settings');
  render(<App/>);expect(screen.getByRole('heading',{name:'Settings page'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Back to workspace'}));
  expect(screen.getByRole('heading',{name:'Workspace home'})).toBeTruthy();
});
