// ============================================
// Overwatch MCP Server - SSE Endpoint
// ============================================
// Vercel Serverless Function
// Exposes Overwatch/JUC-E data to Claude via MCP protocol
// ============================================

import { createClient } from '@supabase/supabase-js';

// ── Supabase ────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://wolhqelloeypafmmvapn.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvbGhxZWxsb2V5cGFmbW12YXBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyODQxODUsImV4cCI6MjA4NDg2MDE4NX0.wQZ14FMQ03A8cBYXBMS1-pII4lKhTL7VNPl9zBCs-EM';
const supabase = createClient(supabaseUrl, supabaseKey);

// ── Calendar IDs ────────────────────────────────────────────────────────────
const CALENDARS = {
  TENTATIVELY_SCHEDULED: 'de3d433f5c6c6a85f5474648e005cac43529d5bed542b74675a37a30cf0ece91@group.calendar.google.com',
  ADMIN_NOTES: 'fff001b042126a6179ac3abe30b1b7928a6f6170227a290d5f24fd0ec2ffa0c9@group.calendar.google.com',
  AUSTIN: 'drhservicetech1@gmail.com',
  JR: 'do0i4f1jqbbakd72mpgpll9m6g@group.calendar.google.com',
  SALES_ACCOUNTING: 'c_aa764bfa5d492c689c26e3ed589df2804a04ee175db1b68d48217bd18883d178@group.calendar.google.com',
  COMPLETED: 'c_a095f8a75a8e3fb1bb4b0f3a2232962af3ab55f05a49ced1e4338abcc865d3e9@group.calendar.google.com',
  INSTALLATIONS: 'd40cddebd7123740ee0eece402546f83806bce96424423535bb15f6ed5abb7c6@group.calendar.google.com',
  RETURN_VISITS: 'drhhsscalendar@gmail.com',
  SHANA: 'shanaparks@drhsecurityservices.com',
};

// ── Job Statuses ────────────────────────────────────────────────────────────
const JOB_STATUS = {
  NEW: 'new',
  NEEDS_DETAILS: 'needs_details',
  NEEDS_PARTS: 'needs_parts',
  PENDING_DECISION: 'pending_decision',
  PENDING_MATERIALS: 'pending_materials',
  READY_TO_SCHEDULE: 'ready_to_schedule',
  RETURN_PENDING: 'return_pending',
  SCHEDULED: 'scheduled',
  COMPLETE: 'complete',
  TO_BILL: 'to_bill',
  BILLED: 'billed',
  NEEDS_ESTIMATE: 'needs_estimate',
  ESTIMATE_SENT: 'estimate_sent',
  WON: 'won',
  LOST: 'lost',
  DEAD: 'dead',
  ARCHIVED: 'archived'
};

// ── MCP Tool Definitions ────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'get_dashboard_stats',
    description: 'Get current dashboard statistics: open jobs, billing queue, estimates pending, parts waiting, returns pending',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_jobs_by_status',
    description: 'Get all jobs with a specific status. Valid statuses: new, needs_details, needs_parts, pending_decision, pending_materials, ready_to_schedule, return_pending, scheduled, complete, to_bill, billed, needs_estimate, estimate_sent, won, lost, dead, archived',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Job status to filter by' },
        limit: { type: 'number', description: 'Max jobs to return (default 50)' }
      },
      required: ['status']
    }
  },
  {
    name: 'get_billing_queue',
    description: 'Get all jobs ready for billing (to_bill, needs_estimate, estimate_sent, won statuses)',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_scheduling_queue',
    description: 'Get all jobs ready to schedule or with returns pending',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_triage_queue',
    description: 'Get all jobs needing triage (new, needs_details, needs_parts, pending_materials)',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'search_customers',
    description: 'Search customers by name, phone, address, or CMS account ID',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_customer_history',
    description: 'Get all jobs and notes for a specific customer',
    inputSchema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'Customer UUID' }
      },
      required: ['customer_id']
    }
  },
  {
    name: 'get_job_details',
    description: 'Get full details for a specific job including notes and assignments',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job UUID' }
      },
      required: ['job_id']
    }
  },
  {
    name: 'update_job_status',
    description: 'Update a job status with required notes. This follows the status machine rules.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job UUID' },
        new_status: { type: 'string', description: 'New status to set' },
        notes: { type: 'string', description: 'Required notes explaining the status change' },
        updated_by: { type: 'string', description: 'Email of person making the change' }
      },
      required: ['job_id', 'new_status', 'notes', 'updated_by']
    }
  },
  {
    name: 'add_job_note',
    description: 'Add a note to an existing job',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job UUID' },
        note: { type: 'string', description: 'Note text' },
        created_by: { type: 'string', description: 'Email of person adding the note' }
      },
      required: ['job_id', 'note', 'created_by']
    }
  },
  {
    name: 'get_techs',
    description: 'Get list of active technicians',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_calendar_ids',
    description: 'Get all DRH calendar IDs for reference',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'create_job',
    description: 'Create a new job in the system',
    inputSchema: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Customer name' },
        customer_phone: { type: 'string', description: 'Customer phone' },
        customer_address: { type: 'string', description: 'Customer address' },
        issue: { type: 'string', description: 'Description of the issue/work needed' },
        job_type: { type: 'string', description: 'Type: service_res, service_com, install, return_trip, estimate, etc.' },
        priority: { type: 'string', description: 'Priority: urgent, high, normal, low' },
        created_by: { type: 'string', description: 'Email of person creating the job' }
      },
      required: ['customer_name', 'issue', 'created_by']
    }
  },
  {
    name: 'get_gap_report',
    description: 'Get jobs with remaining balance that may be missing calendar events or invoices (the $147K gap)',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'create_return_visit',
    description: 'Create a return visit linked to an existing job. The new job inherits customer info and links back to the parent.',
    inputSchema: {
      type: 'object',
      properties: {
        parent_job_id: { type: 'string', description: 'UUID of the original job' },
        issue: { type: 'string', description: 'Reason for return visit' },
        notes: { type: 'string', description: 'Additional notes' },
        created_by: { type: 'string', description: 'Email of person creating' }
      },
      required: ['parent_job_id', 'issue', 'created_by']
    }
  },
  {
    name: 'get_job_family',
    description: 'Get a job with all its linked jobs (parent, siblings, children). Use this to see the full history of a multi-visit job.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job UUID' }
      },
      required: ['job_id']
    }
  }
];

// ── Tool Handlers ───────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case 'get_dashboard_stats': {
      const { data: allJobs } = await supabase
        .from('jobs')
        .select('*')
        .not('status', 'in', '(billed,archived,lost,dead)');
      
      const jobs = allJobs || [];
      return {
        total_open: jobs.length,
        needs_action: jobs.filter(j => j.status === 'new').length,
        scheduled: jobs.filter(j => j.status === 'scheduled').length,
        to_bill: jobs.filter(j => j.status === 'to_bill').length,
        estimates_pending: jobs.filter(j => j.status === 'estimate_sent').length,
        waiting_on_parts: jobs.filter(j => j.status === 'needs_parts').length,
        returns_pending: jobs.filter(j => j.status === 'return_pending').length,
        pipeline_value: jobs
          .filter(j => ['needs_estimate', 'estimate_sent'].includes(j.status))
          .reduce((sum, j) => sum + (parseFloat(j.estimate_amount) || 0), 0)
      };
    }

    case 'get_jobs_by_status': {
      const { status, limit = 50 } = args;
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    }

    case 'get_billing_queue': {
      const { data } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['to_bill', 'needs_estimate', 'estimate_sent', 'won'])
        .order('created_at', { ascending: false });
      return data || [];
    }

    case 'get_scheduling_queue': {
      const { data } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['ready_to_schedule', 'return_pending'])
        .order('created_at', { ascending: false });
      return data || [];
    }

    case 'get_triage_queue': {
      const { data } = await supabase
        .from('jobs')
        .select('*')
        .in('status', ['new', 'needs_details', 'needs_parts', 'pending_materials'])
        .order('created_at', { ascending: false });
      return data || [];
    }

    case 'search_customers': {
      const { query } = args;
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('is_active', true)
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%,address.ilike.%${query}%,cms_account_id.ilike.%${query}%`)
        .order('name')
        .limit(25);
      return data || [];
    }

    case 'get_customer_history': {
      const { customer_id } = args;
      const { data: customer } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customer_id)
        .single();
      
      const { data: jobs } = await supabase
        .from('jobs')
        .select('*')
        .eq('customer_id', customer_id)
        .order('created_at', { ascending: false });
      
      return { customer, jobs: jobs || [] };
    }

    case 'get_job_details': {
      const { job_id } = args;
      const { data: job } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', job_id)
        .single();
      
      const { data: history } = await supabase
        .from('job_history')
        .select('*')
        .eq('job_id', job_id)
        .order('changed_at', { ascending: false });
      
      const { data: assignments } = await supabase
        .from('job_assignments')
        .select('*, tech:techs(name, color)')
        .eq('job_id', job_id)
        .order('scheduled_for', { ascending: true });
      
      return { job, history: history || [], assignments: assignments || [] };
    }

    case 'update_job_status': {
      const { job_id, new_status, notes, updated_by } = args;
      
      // Get current job
      const { data: job } = await supabase
        .from('jobs')
        .select('status')
        .eq('id', job_id)
        .single();
      
      if (!job) throw new Error('Job not found');
      
      // Update job status
      const { error: updateError } = await supabase
        .from('jobs')
        .update({ 
          status: new_status, 
          updated_by,
          updated_at: new Date().toISOString()
        })
        .eq('id', job_id);
      
      if (updateError) throw updateError;
      
      // Log the change
      await supabase.from('job_history').insert({
        job_id,
        from_status: job.status,
        to_status: new_status,
        notes,
        changed_by: updated_by,
        changed_at: new Date().toISOString()
      });
      
      return { success: true, from: job.status, to: new_status };
    }

    case 'add_job_note': {
      const { job_id, note, created_by } = args;
      
      const { data: job } = await supabase
        .from('jobs')
        .select('status')
        .eq('id', job_id)
        .single();
      
      const { data, error } = await supabase
        .from('job_history')
        .insert({
          job_id,
          from_status: job?.status,
          to_status: job?.status,
          notes: note,
          changed_by: created_by,
          changed_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    }

    case 'get_techs': {
      const { data } = await supabase
        .from('techs')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      return data || [];
    }

    case 'get_calendar_ids': {
      return CALENDARS;
    }

    case 'create_job': {
      const { 
        customer_name, 
        customer_phone, 
        customer_address, 
        issue, 
        job_type = 'service_res',
        priority = 'normal',
        created_by 
      } = args;
      
      // Generate job number
      const { data: lastJob } = await supabase
        .from('jobs')
        .select('job_number')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      const lastNum = lastJob?.job_number ? parseInt(lastJob.job_number.replace('DRH-', '')) : 5000;
      const newJobNumber = `DRH-${lastNum + 1}`;
      
      const { data, error } = await supabase
        .from('jobs')
        .insert({
          job_number: newJobNumber,
          customer_name,
          customer_phone,
          customer_address,
          issue,
          job_type,
          priority,
          status: 'new',
          created_by,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    }

    case 'get_gap_report': {
      const { data } = await supabase
        .from('jobs')
        .select('*')
        .gt('remaining_amount', 0)
        .order('remaining_amount', { ascending: false });
      
      const jobs = data || [];
      const total = jobs.reduce((sum, j) => sum + (j.remaining_amount || 0), 0);
      
      return {
        total_gap: total,
        job_count: jobs.length,
        jobs: jobs.slice(0, 50) // Top 50 by remaining amount
      };
    }

    case 'create_return_visit': {
      const { parent_job_id, issue, notes, created_by } = args;
      
      // Get parent job
      const { data: parent } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', parent_job_id)
        .single();
      
      if (!parent) throw new Error('Parent job not found');
      
      // Generate job number
      const { data: lastJob } = await supabase
        .from('jobs')
        .select('job_number')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      const lastNum = lastJob?.job_number ? parseInt(lastJob.job_number.replace('DRH-', '')) : 5000;
      const newJobNumber = `DRH-${lastNum + 1}`;
      
      // Create linked return visit
      const { data: newJob, error } = await supabase
        .from('jobs')
        .insert({
          job_number: newJobNumber,
          customer_name: parent.customer_name,
          customer_phone: parent.customer_phone,
          customer_address: parent.customer_address,
          customer_id: parent.customer_id,
          parent_job_id: parent_job_id,
          job_type: 'return_trip',
          issue: issue,
          priority: parent.priority,
          status: 'return_pending',
          created_by: created_by,
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      
      // Log to parent job history
      await supabase.from('job_history').insert({
        job_id: parent_job_id,
        notes: `Return visit created: ${newJobNumber} - ${issue}`,
        changed_by: created_by,
        changed_at: new Date().toISOString()
      });
      
      return {
        success: true,
        new_job: newJob,
        parent_job_number: parent.job_number,
        linked: true
      };
    }

    case 'get_job_family': {
      const { job_id } = args;
      
      const { data: job } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', job_id)
        .single();
      
      if (!job) throw new Error('Job not found');
      
      let parent = null;
      let siblings = [];
      let children = [];
      
      // If this job has a parent, get it and siblings
      if (job.parent_job_id) {
        const { data: p } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.parent_job_id)
          .single();
        parent = p;
        
        const { data: sibs } = await supabase
          .from('jobs')
          .select('*')
          .eq('parent_job_id', job.parent_job_id)
          .neq('id', job_id)
          .order('created_at', { ascending: true });
        siblings = sibs || [];
      }
      
      // Get children of this job
      const { data: kids } = await supabase
        .from('jobs')
        .select('*')
        .eq('parent_job_id', job_id)
        .order('created_at', { ascending: true });
      children = kids || [];
      
      return {
        job,
        parent,
        siblings,
        children,
        is_part_of_series: !!(parent || children.length > 0 || siblings.length > 0)
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP Protocol Handler ────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // SSE endpoint
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', server: 'overwatch-mcp', version: '1.0.0' })}\n\n`);
    
    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(`: keepalive\n\n`);
    }, 30000);
    
    req.on('close', () => {
      clearInterval(keepAlive);
    });
    
    return;
  }

  // JSON-RPC handler for MCP
  if (req.method === 'POST') {
    try {
      const { method, params, id } = req.body;
      
      let result;
      
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'overwatch-mcp',
              version: '1.0.0'
            }
          };
          break;
          
        case 'tools/list':
          result = { tools: TOOLS };
          break;
          
        case 'tools/call':
          const { name, arguments: args } = params;
          const toolResult = await handleTool(name, args || {});
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify(toolResult, null, 2)
            }]
          };
          break;
          
        default:
          return res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32601, message: `Method not found: ${method}` },
            id
          });
      }
      
      return res.status(200).json({
        jsonrpc: '2.0',
        result,
        id
      });
      
    } catch (error) {
      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: error.message },
        id: req.body?.id
      });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}

// Vercel config
export const config = {
  api: {
    bodyParser: true,
  },
};
