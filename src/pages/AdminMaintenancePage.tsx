import { FormEvent, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useAdminProperty } from '../components/AdminShell';
import { Spinner } from '../components/Spinner';

type Task = { _id: string; unitName: string; title: string; description: string; priority: string; status: string; removesInventory: boolean; version: number };

export function AdminMaintenancePage() {
  const { property, enabledFeatures } = useAdminProperty();
  const enabled = enabledFeatures.includes('maintenance');
  const tasks = useQuery(api.housekeeping.maintenanceBoard, enabled ? { propertyId: property.propertyId } : 'skip') as Task[] | undefined;
  const foundation = useQuery((api as any).operationsFoundation.snapshot, enabled ? { propertyId: property.propertyId } : 'skip') as { units: Array<{ unitId: string; name: string }> } | undefined;
  const createTask = useMutation(api.operations.createMaintenanceTask);
  const resolveTask = useMutation(api.housekeeping.resolveMaintenance);
  const [message, setMessage] = useState<string | null>(null);
  const [removesInventory, setRemovesInventory] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(null); const data = new FormData(event.currentTarget);
    try {
      await createTask({ propertyId: property.propertyId, unitId: data.get('unitId') as any, title: String(data.get('title') ?? ''), description: String(data.get('description') ?? ''), priority: String(data.get('priority')) as any, removesInventory, checkIn: removesInventory ? String(data.get('checkIn')) : undefined, checkOut: removesInventory ? String(data.get('checkOut')) : undefined, requestId: crypto.randomUUID() });
      event.currentTarget.reset(); setRemovesInventory(false); setMessage('Maintenance task created.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Task was not created.'); }
  }

  if (!enabled) return <div className="card max-w-2xl p-6"><h1 className="text-2xl font-semibold">Maintenance</h1><p className="mt-2 text-sm text-stone-600">Installed and protected by the <code>maintenance</code> property flag.</p></div>;
  return <div className="space-y-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Service operations</p><h1 className="mt-1 text-2xl font-semibold">Maintenance</h1><p className="mt-1 text-sm text-stone-600">Tasks do not remove sellable inventory unless a dated block is explicitly linked.</p></div>{message ? <p className="rounded-lg bg-stone-900 px-4 py-3 text-sm text-white" role="status">{message}</p> : null}<form className="card grid gap-3 p-4 lg:grid-cols-4" onSubmit={(event) => void submit(event)}><label><span className="field-label">Unit</span><select className="field-input" name="unitId" required><option value="">Choose a unit</option>{foundation?.units.map((unit) => <option key={unit.unitId} value={unit.unitId}>{unit.name}</option>)}</select></label><label><span className="field-label">Task</span><input className="field-input" name="title" required /></label><label><span className="field-label">Priority</span><select className="field-input" name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label><span className="field-label">Description</span><input className="field-input" name="description" /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={removesInventory} onChange={(event) => setRemovesInventory(event.target.checked)} /> Link an inventory block</label>{removesInventory ? <><label><span className="field-label">Block from</span><input type="date" className="field-input" name="checkIn" required /></label><label><span className="field-label">Block until</span><input type="date" className="field-input" name="checkOut" required /></label></> : null}<button className="btn-primary self-end" type="submit">Create task</button></form>{tasks === undefined ? <Spinner label="Loading maintenance…" /> : <div className="space-y-3">{tasks.map((task) => <article key={task._id} className="card flex flex-wrap items-center justify-between gap-4 p-4"><div><h2 className="font-semibold">{task.title}</h2><p className="text-sm text-stone-500">{task.unitName} · {task.priority} · {task.removesInventory ? 'inventory blocked' : 'inventory remains sellable'}</p></div>{['open', 'in_progress'].includes(task.status) ? <button type="button" className="btn-primary" onClick={() => void resolveTask({ propertyId: property.propertyId, maintenanceTaskId: task._id as any, expectedVersion: task.version, requestId: crypto.randomUUID() }).catch((error) => setMessage(error instanceof Error ? error.message : 'Resolve failed.'))}>Resolve</button> : <span className="badge">{task.status}</span>}</article>)}</div>}</div>;
}
