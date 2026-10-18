import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimelineTab } from './TimelineTab';
import { listProjectTimeline, listSessionTimeline } from '../../lib/api';
import type { TimelineEvent } from '@open-brain/shared';

vi.mock('../../lib/api',()=>({listProjectTimeline:vi.fn(),listSessionTimeline:vi.fn()}));
const projectId='00000000-0000-4000-8000-000000000001';
const event=(id:string,title:string):TimelineEvent=>({id,project_id:projectId,entity_id:projectId,entity_type:'document',action:'uploaded',title,changed_fields:[],tags:['design'],occurred_at:`2026-01-0${4-Number(id)}T12:00:00Z`,reconstructed:false});
const first=event('1','Recent ordinary upload'), second=event('2','Needle design'), third=event('3','Needle archive');
const cursor={at:second.occurred_at,id:second.id};
const scrollTo=vi.fn();
beforeEach(()=>{
  vi.clearAllMocks();
  Object.defineProperty(window,'matchMedia',{writable:true,value:vi.fn().mockReturnValue({matches:true})});
  HTMLElement.prototype.scrollTo=scrollTo;
  vi.mocked(listProjectTimeline).mockImplementation(async(_id,search,before)=>({
    events:before?[third]:search?[second]:[first,second],total:search?2:3,next_cursor:before?null:cursor,available_tags:['design','release'],
  }));
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function mount(sessionId?:string){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><TimelineTab projectId={sessionId?undefined:projectId} sessionId={sessionId}/></QueryClientProvider>);}

it('shows project and session origins and applies one shared tag across all of them',async()=>{
  const entries=[
    {...event('1','Project spec'),session_id:null,session_name:null,tags:['front-end','project-only']},
    {...event('2','Design spec'),session_id:'00000000-0000-4000-8000-000000000002',session_name:'Design review',tags:['front-end','session-one']},
    {...event('3','Implementation spec'),session_id:'00000000-0000-4000-8000-000000000003',session_name:'Implementation',tags:['front-end','session-two']},
    {...event('4','Server spec'),occurred_at:'2026-01-01T11:00:00Z',session_id:'00000000-0000-4000-8000-000000000003',session_name:'Implementation',tags:['back-end']},
  ];
  vi.mocked(listProjectTimeline).mockImplementation(async(_id,_search,_before,_signal,tags=[])=>{
    const events=entries.filter(e=>!tags.length||e.tags.some(tag=>tags.includes(tag)));
    return {events,total:events.length,next_cursor:null,available_tags:['back-end','front-end','project-only','session-one','session-two']};
  });
  const view=mount();await screen.findByText('Project spec');
  expect(screen.getByText('Project-level')).toBeTruthy();
  expect(screen.getByText('Session: Design review')).toBeTruthy();
  expect(screen.getAllByText('Session: Implementation')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Filter by tags'}));
  expect(screen.getAllByRole('checkbox',{name:'#front-end'})).toHaveLength(1);
  fireEvent.click(screen.getByRole('checkbox',{name:'#front-end'}));
  await waitFor(()=>expect(view.container.querySelectorAll('[data-event-id]')).toHaveLength(3));
  expect(screen.queryByText('Server spec')).toBeNull();
  expect(screen.getByText('Project spec')).toBeTruthy();
  expect(screen.getByText('Design spec')).toBeTruthy();
  expect(screen.getByText('Implementation spec')).toBeTruthy();
  expect(screen.getByRole('checkbox',{name:'#back-end'})).toBeTruthy();
});

it('search keeps chronology visible, highlights and scrolls to a match, and reaches unloaded history',async()=>{
  const view=mount();
  await screen.findByText('Recent ordinary upload');
  fireEvent.change(screen.getByRole('textbox',{name:'Search timeline'}),{target:{value:'Needle'}});
  await screen.findByText('Match 1 of 2');
  await waitFor(()=>expect(view.container.querySelector('[aria-current="true"]')?.getAttribute('data-event-id')).toBe('2'));
  expect(screen.getByText('Recent ordinary upload')).toBeTruthy();
  expect(view.container.querySelector('mark')?.textContent).toBe('Needle');
  expect(scrollTo).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Next match'}));
  await screen.findByText('Match 2 of 2');
  await waitFor(()=>expect(view.container.querySelector('[aria-current="true"]')?.getAttribute('data-event-id')).toBe('3'));
  expect(vi.mocked(listProjectTimeline)).toHaveBeenCalledWith(projectId,'',cursor,expect.anything(),[],'all');
  expect(vi.mocked(listProjectTimeline)).toHaveBeenCalledWith(projectId,'Needle',cursor,expect.anything(),[],'all');
  expect(screen.getByRole('button',{name:'Next match'}).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Previous match'}));
  await screen.findByText('Match 1 of 2');
  fireEvent.click(screen.getByRole('button',{name:'Clear timeline search'}));
  await waitFor(()=>expect(view.container.querySelector('[aria-current="true"]')).toBeNull());
});

it('reports no matches without removing history',async()=>{
  const original=vi.mocked(listProjectTimeline).getMockImplementation()!;
  vi.mocked(listProjectTimeline).mockImplementation(async(...args)=>args[1]?{events:[],total:0,next_cursor:null,available_tags:['design','release']}:original(...args));
  mount(); await screen.findByText('Recent ordinary upload');
  fireEvent.change(screen.getByRole('textbox',{name:'Search timeline'}),{target:{value:'absent'}});
  await screen.findByText('No matching events');
  expect(screen.getByText('Recent ordinary upload')).toBeTruthy();
});

it('shows a recoverable error when history cannot load',async()=>{
  vi.mocked(listProjectTimeline).mockRejectedValueOnce(new Error('offline'));
  mount();await screen.findByText('Couldn’t load the timeline.');
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await screen.findByText('Recent ordinary upload');
});

it('keeps the timeline viewport in place while a tag change loads',async()=>{
  mount();await screen.findByText('Recent ordinary upload');
  vi.mocked(listProjectTimeline).mockImplementation(()=>new Promise(()=>{}));
  fireEvent.click(screen.getByRole('button',{name:'Filter by tags'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'#release'}));
  await screen.findByText('Loading events…');
  expect(screen.getByRole('region',{name:'Project timeline'})).toBeTruthy();
});

it('keeps the checkbox dropdown open, combines selected tags, and clears back to all events',async()=>{
  const design={...first,tags:['design']},release={...second,tags:['release']},both={...third,tags:['design','release']};
  vi.mocked(listProjectTimeline).mockImplementation(async(_id,_search,_before,_signal,tags=[],tagMatch='all')=>{
    const events=[design,release,both].filter(event=>!tags.length||(tagMatch==='any'?tags.some(tag=>event.tags.includes(tag)):tags.every(tag=>event.tags.includes(tag))));
    return {events,total:events.length,next_cursor:null,available_tags:['design','release']};
  });
  const view=mount();await screen.findByText('Recent ordinary upload');
  expect(screen.getByRole('button',{name:'AND'}).getAttribute('aria-pressed')).toBe('true');
  expect(view.container.querySelectorAll('.timeline-event-tags')).toHaveLength(3);
  const trigger=screen.getByRole('button',{name:'Filter by tags'});
  fireEvent.click(trigger);
  const designCheckbox=screen.getByRole('checkbox',{name:'#design'});
  fireEvent.click(designCheckbox);
  await waitFor(()=>expect(view.container.querySelectorAll('[data-event-id]')).toHaveLength(2));
  expect(screen.queryByText('Needle design')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(designCheckbox);
  fireEvent.click(screen.getByRole('checkbox',{name:'#release'}));
  await waitFor(()=>expect(view.container.querySelectorAll('[data-event-id]')).toHaveLength(1));
  expect(screen.getByText('Match all selected tags')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'OR'}));
  await screen.findByText('Needle design');
  expect(view.container.querySelectorAll('[data-event-id]')).toHaveLength(3);
  expect(screen.getByRole('button',{name:'OR'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Match any selected tag')).toBeTruthy();
  fireEvent.blur(designCheckbox,{relatedTarget:null});
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'Clear tags'}));
  await waitFor(()=>expect(screen.getByRole('checkbox',{name:'#design'}).hasAttribute('checked')).toBe(false));
  await waitFor(()=>expect(view.container.querySelectorAll('[data-event-id]')).toHaveLength(3));
  fireEvent.keyDown(screen.getByRole('group',{name:'Filter timeline tags'}),{key:'Escape'});
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});

it('searches and autoscrolls within the selected tag filter, including older pages',async()=>{
  const view=mount();await screen.findByText('Recent ordinary upload');
  fireEvent.click(screen.getByRole('button',{name:'Filter by tags'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'#design'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Search timeline'}),{target:{value:'Needle'}});
  await screen.findByText('Match 1 of 2');
  fireEvent.click(screen.getByRole('button',{name:'Next match'}));
  await screen.findByText('Match 2 of 2');
  await waitFor(()=>expect(view.container.querySelector('[aria-current="true"]')?.getAttribute('data-event-id')).toBe('3'));
  expect(vi.mocked(listProjectTimeline)).toHaveBeenCalledWith(projectId,'',cursor,expect.anything(),['design'],'all');
  expect(vi.mocked(listProjectTimeline)).toHaveBeenCalledWith(projectId,'Needle',cursor,expect.anything(),['design'],'all');
  fireEvent.click(screen.getByRole('button',{name:'OR'}));
  await screen.findByText('Match 1 of 2');
  fireEvent.click(screen.getByRole('button',{name:'Next match'}));
  await screen.findByText('Match 2 of 2');
  expect(vi.mocked(listProjectTimeline)).toHaveBeenCalledWith(projectId,'',cursor,expect.anything(),['design'],'any');
  expect(vi.mocked(listProjectTimeline)).toHaveBeenCalledWith(projectId,'Needle',cursor,expect.anything(),['design'],'any');
});

it('uses the same default and toggle for a session timeline',async()=>{
  vi.mocked(listSessionTimeline).mockResolvedValue({events:[first],total:1,next_cursor:null,available_tags:['design']});
  const sessionId='00000000-0000-4000-8000-000000000002';
  mount(sessionId);await screen.findByText('Recent ordinary upload');
  expect(vi.mocked(listSessionTimeline)).toHaveBeenCalledWith(sessionId,'',null,expect.anything(),[],'all');
  fireEvent.click(screen.getByRole('button',{name:'OR'}));
  await waitFor(()=>expect(vi.mocked(listSessionTimeline)).toHaveBeenCalledWith(sessionId,'',null,expect.anything(),[],'any'));
  fireEvent.click(screen.getByRole('button',{name:'AND'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'AND'}).getAttribute('aria-pressed')).toBe('true'));
});

it('updates the minimal position indicator from the events in view',async()=>{
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    const id=this.getAttribute('data-event-id');
    const top=id==='1'?-70:id==='2'?20:0;
    return {top,bottom:id?top+50:100,left:0,right:500,width:500,height:id?50:100,x:0,y:top,toJSON:()=>({})};
  });
  mount();await screen.findByText('Recent ordinary upload');
  fireEvent.scroll(screen.getByRole('region',{name:'Project timeline'}));
  await waitFor(()=>expect(screen.getByRole('meter',{name:'Timeline position'}).getAttribute('aria-valuenow')).toBe('2'));
  expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('Events 2–2 of 3');
});

it('keeps author filters usable inside a shadow-root host', async () => {
  const host=document.createElement('div');document.body.append(host);
  const root=host.attachShadow({mode:'open'});
  const surface=document.createElement('div');root.append(surface);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=render(<QueryClientProvider client={client}><TimelineTab projectId={projectId}/></QueryClientProvider>,{container:surface});
  const ui=within(surface);
  await ui.findByText('Recent ordinary upload');
  fireEvent.click(ui.getByRole('button',{name:'Filter by tags'}));
  const checkbox=ui.getByRole('checkbox',{name:'#design'});
  fireEvent.mouseDown(checkbox,{composed:true});
  expect(ui.getByRole('button',{name:'Filter by tags'}).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(checkbox);
  await waitFor(()=>expect((ui.getByRole('checkbox',{name:'#design'}) as HTMLInputElement).checked).toBe(true));
  expect(vi.mocked(listProjectTimeline)).toHaveBeenLastCalledWith(projectId,'',null,expect.anything(),['design'],'all');
  view.unmount();host.remove();
});
