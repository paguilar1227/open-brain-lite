import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { liteRequest } from '../lib/api';
vi.mock('../lib/api',()=>({liteRequest:vi.fn(),isLocalAccess:()=>true,logout:vi.fn()}));
vi.mock('../lib/notifications',()=>({enableNotifications:vi.fn()}));
const initial={provider:'copilot',localModel:'qwen3.5:4b',embeddingModel:'embeddinggemma',llamaUrl:'http://llama:8080/v1',llamaModel:'local-model',copilotModel:'claude-sonnet-5.5',chatgptModel:'gpt-6-luna'};
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(liteRequest).mockImplementation(async(path,options)=>{
    if(path==='/runtime') return options?.method==='PUT'?{ok:true}:initial;
    if(path==='/providers/copilot/models') return {status:'available',models:[{id:'claude-sonnet-5.5',name:'Claude Sonnet 5.5'},{id:'other',name:'Another model'}],message:'Models available through your GitHub Copilot account.'};
    return {status:'manual',models:[],message:'Enter a supported model.'};
  });
});
afterEach(cleanup);
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><SettingsPage theme="light" onTheme={vi.fn()} onBack={vi.fn()}/></QueryClientProvider>);}
it('explains both model roles and shows only the selected provider controls',async()=>{
  mount();await screen.findByRole('heading',{name:'Answers & understanding'});
  expect(screen.getByRole('heading',{name:'Search & retrieval'})).toBeTruthy();
  expect(screen.getByText('embeddinggemma')).toBeTruthy();
  await screen.findByRole('option',{name:'Claude Sonnet 5.5'});
  expect(screen.queryByLabelText('Local model')).toBeNull();
  expect(screen.queryByLabelText('llama.cpp endpoint')).toBeNull();
  expect(screen.queryByRole('button',{name:'Sign in with ChatGPT'})).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('saves a selected model and preserves other provider and embedding settings',async()=>{
  mount();await screen.findByRole('option',{name:'Another model'});
  fireEvent.change(screen.getByLabelText('Completion model'),{target:{value:'other'}});
  fireEvent.click(screen.getByRole('button',{name:'Save model settings'}));
  await screen.findByText('Model settings saved.');
  const request=vi.mocked(liteRequest).mock.calls.find(([path,options])=>path==='/runtime'&&options?.method==='PUT')!;
  expect(JSON.parse(request[1]!.body as string)).toEqual({...initial,copilotModel:'other'});
});
it('keeps separate model choices when switching providers and hides advanced endpoint details',async()=>{
  mount();await screen.findByRole('option',{name:'Another model'});
  fireEvent.change(screen.getByLabelText('Completion model'),{target:{value:'other'}});
  fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'llama.cpp'}});
  await screen.findByDisplayValue('local-model');
  expect(screen.getByText('Advanced connection').closest('details')?.open).toBe(false);
  fireEvent.change(screen.getByLabelText('Provider'),{target:{value:'copilot'}});
  await waitFor(()=>expect((screen.getByLabelText('Completion model') as HTMLSelectElement).value).toBe('other'));
});
it('preserves the chosen model after a failed save',async()=>{
  const original=vi.mocked(liteRequest).getMockImplementation()!;
  vi.mocked(liteRequest).mockImplementation(async(path,options)=>{if(options?.method==='PUT')throw new Error('offline');return original(path,options);});
  mount();await screen.findByRole('option',{name:'Another model'});
  fireEvent.change(screen.getByLabelText('Completion model'),{target:{value:'other'}});
  fireEvent.click(screen.getByRole('button',{name:'Save model settings'}));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Completion model') as HTMLSelectElement).value).toBe('other');
});
