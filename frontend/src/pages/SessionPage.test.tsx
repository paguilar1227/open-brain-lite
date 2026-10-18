import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SessionPage} from './SessionPage';
import {SessionsPage} from './SessionsPage';
import * as api from '../lib/api';
vi.mock('../lib/api',()=>({getSession:vi.fn(),listSessions:vi.fn(),createSession:vi.fn(),updateSession:vi.fn(),deleteSession:vi.fn(),listContent:vi.fn(),listTodos:vi.fn(),createTodo:vi.fn(),updateTodo:vi.fn(),search:vi.fn(),getContent:vi.fn(),getTodo:vi.fn()}));
vi.mock('../lib/useProjects',()=>({useProjects:()=>({data:[{id:'p1',name:'Project one'}]})}));
vi.mock('./project/TimelineTab',()=>({TimelineTab:({sessionId}:any)=><div>Timeline for {sessionId}</div>}));
const session={id:'s1',name:'Design session',project_id:'p1',summary:'',decisions:[],next_steps:[],counts:{notes:1,documents:2,todos:1},updated_at:'2026-01-01',created_at:'2026-01-01',session_key:'key',note_id:null};
const go=vi.fn(),action=vi.fn();
function mount(node=<SessionPage sessionId="s1" onRoute={go} onAction={action}/>){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{node}</QueryClientProvider>);}
beforeEach(()=>{
 vi.clearAllMocks();vi.mocked(api.getSession).mockResolvedValue(session);vi.mocked(api.listContent).mockResolvedValue([]);vi.mocked(api.listTodos).mockResolvedValue([]);vi.mocked(api.listSessions).mockResolvedValue([session]);vi.mocked(api.search).mockResolvedValue([]);vi.mocked(api.deleteSession).mockResolvedValue({ok:true,pending_files:0});
});
afterEach(cleanup);
it('loads only session-owned artifacts and exposes the shared timeline',async()=>{
 mount();await screen.findByRole('heading',{name:'Design session'});expect(screen.getByText('Timeline for s1')).toBeTruthy();
 expect(api.listContent).toHaveBeenCalledWith({type:'note',session_id:'s1'});expect(api.listContent).toHaveBeenCalledWith({type:'document',session_id:'s1'});expect(api.listTodos).toHaveBeenCalledWith({session_id:'s1'});
 fireEvent.click(screen.getByRole('tab',{name:/^Notes/}));fireEvent.click(screen.getByRole('button',{name:'New note'}));expect(action).toHaveBeenCalledWith({kind:'note-edit',payload:null,projectId:'p1',sessionId:'s1'});
 fireEvent.click(screen.getByRole('tab',{name:/^Documents/}));fireEvent.click(screen.getByRole('button',{name:'Upload artifact'}));expect(action.mock.lastCall?.[0].sessionId).toBe('s1');
});
it('searches session, project and global scope explicitly',async()=>{
 mount();await screen.findByRole('heading',{name:'Design session'});fireEvent.change(screen.getByRole('textbox',{name:'Search workspace'}),{target:{value:'release'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));await waitFor(()=>expect(api.search).toHaveBeenCalledWith({query:'release',session_id:'s1'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Search scope'}),{target:{value:'project'}});await waitFor(()=>expect(api.search).toHaveBeenCalledWith({query:'release',project_id:'p1'}));
 fireEvent.change(screen.getByRole('combobox',{name:'Search scope'}),{target:{value:'all'}});await waitFor(()=>expect(api.search).toHaveBeenCalledWith({query:'release'}));
});
it('standalone sessions omit the project search option',async()=>{
 vi.mocked(api.getSession).mockResolvedValue({...session,project_id:null});mount();await screen.findByRole('heading',{name:'Design session'});expect(screen.queryByRole('option',{name:'This project'})).toBeNull();expect(screen.getByText('Standalone session')).toBeTruthy();
});
it('requires typing the session name before destructive deletion and explains content removal',async()=>{
 mount();await screen.findByRole('heading',{name:'Design session'});fireEvent.click(screen.getByRole('button',{name:'Manage session'}));fireEvent.click(screen.getByRole('button',{name:'Delete session'}));
 const button=screen.getByRole('button',{name:'Delete session forever'});expect((button as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(/permanently deletes the session/).textContent).toContain('1 notes, 2 documents, 1 todos');expect(api.deleteSession).not.toHaveBeenCalled();
 const fields=screen.getAllByRole('textbox');fireEvent.change(fields.at(-1)!,{target:{value:'Design session'}});fireEvent.click(button);await waitFor(()=>expect(api.deleteSession).toHaveBeenCalledWith('s1'));await waitFor(()=>expect(go).toHaveBeenCalledWith({route:'sessions'}));
});
it('creates standalone or project sessions and navigates to the new workspace',async()=>{
 vi.mocked(api.createSession).mockResolvedValue(session);mount(<SessionsPage onRoute={go}/>);await screen.findByText('Design session');fireEvent.click(screen.getByRole('button',{name:'New session'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Name'}),{target:{value:'Next conversation'}});fireEvent.click(screen.getByRole('button',{name:'Create session'}));await waitFor(()=>expect(api.createSession).toHaveBeenCalledWith({name:'Next conversation',project_id:null}));expect(go).toHaveBeenCalledWith({route:'session',session:'s1'});
});
