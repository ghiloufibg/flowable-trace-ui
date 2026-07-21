// Mock Flowable process data — realistic BPMN structures for the console prototype.
// Coordinates are BPMN-DI style (x,y top-left) on a ~1100x420 canvas.

export type NodeState = "active" | "completed" | "failed" | "waiting" | "pending";

export type BpmnNodeType =
  | "startEvent"
  | "endEvent"
  | "userTask"
  | "serviceTask"
  | "scriptTask"
  | "exclusiveGateway"
  | "parallelGateway"
  | "callActivity"
  | "boundaryTimer";

export interface BpmnNode {
  id: string;
  name: string;
  type: BpmnNodeType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  state: NodeState;
  // per-type detail
  assignee?: string;
  candidateGroups?: string[];
  dueDate?: string;
  priority?: number;
  // multi-instance
  multiInstance?: { total: number; active: number; completed: number };
  // gateway
  gatewayDecision?: string;
  // failed job
  jobError?: {
    exceptionClass: string;
    message: string;
    stackTrace: string;
    retries: number;
  };
  // timer
  timerDueAt?: string;
  // call activity
  childInstanceId?: string;
  // attachedTo (for boundary events)
  attachedTo?: string;
}

export interface BpmnEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string;
  taken?: boolean; // undefined = not yet evaluated
  waypoints?: Array<{ x: number; y: number }>;
}

export interface VariableChange {
  timestamp: string;
  revision: number;
  oldValue: string | null;
  newValue: string;
}
export interface Variable {
  name: string;
  type: string;
  value: string;
  history: VariableChange[];
}

export interface TaskItem {
  id: string;
  name: string;
  assignee?: string;
  candidateGroups?: string[];
  dueDate?: string;
  priority: number;
  status: "pending" | "completed";
  completedBy?: string;
  durationMs?: number;
}

export interface TrailEntry {
  id: string;
  activityId: string;
  activityName: string;
  type: BpmnNodeType;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
}

export interface JobItem {
  id: string;
  type: "timer" | "async" | "deadletter";
  activityId: string;
  activityName: string;
  dueDate?: string;
  retries?: number;
  exception?: string;
}

export interface ProcessInstance {
  id: string;
  definitionKey: string;
  definitionName: string;
  version: number;
  businessKey: string;
  status: "active" | "ended" | "failed";
  startedAt: string; // ISO
  endedAt?: string;
  startedBy: string;
  deployedAt: string;
  parentInstanceId?: string;
  nodes: BpmnNode[];
  edges: BpmnEdge[];
  variables: Variable[];
  tasks: TaskItem[];
  trail: TrailEntry[];
  jobs: JobItem[];
  /**
   * Summary-only: cheap subset of `nodes` a list-endpoint response can carry
   * so rows render without a per-id enrichment fetch. Undefined on full
   * detail responses; callers prefer this when present and fall back to
   * filtering `nodes` (see `currentActivities` in store.ts).
   */
  activeActivities?: BpmnNode[];
  /**
   * Summary-only: precomputed dead-letter job count. Undefined on full
   * detail responses; callers fall back to filtering `jobs`.
   */
  failedJobCount?: number;
}

// -- helpers ---------------------------------------------------------------

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

// -- 1. Simple active order approval (sitting at user task) ----------------

const p1: ProcessInstance = {
  id: "PI-8fa21c04",
  definitionKey: "orderApproval",
  definitionName: "Order Approval",
  version: 4,
  businessKey: "ORDER-10482",
  status: "active",
  startedAt: iso(1000 * 60 * 2),
  startedBy: "checkout-service@svc",
  deployedAt: iso(1000 * 60 * 60 * 24 * 12),
  nodes: [
    { id: "start", name: "Order placed", type: "startEvent", x: 60, y: 180, state: "completed" },
    { id: "validate", name: "Validate order", type: "serviceTask", x: 160, y: 155, state: "completed" },
    {
      id: "approve", name: "Manager approval", type: "userTask", x: 360, y: 155, state: "active",
      assignee: "sarah.chen", candidateGroups: ["approvers", "managers"],
      dueDate: iso(-1000 * 60 * 60 * 4), priority: 50,
    },
    { id: "notify", name: "Notify customer", type: "serviceTask", x: 560, y: 155, state: "pending" },
    { id: "end", name: "Approved", type: "endEvent", x: 760, y: 180, state: "pending" },
  ],
  edges: [
    { id: "f1", source: "start", target: "validate" },
    { id: "f2", source: "validate", target: "approve" },
    { id: "f3", source: "approve", target: "notify" },
    { id: "f4", source: "notify", target: "end" },
  ],
  variables: [
    { name: "orderId", type: "String", value: "ORDER-10482", history: [
      { timestamp: iso(1000 * 60 * 2), revision: 1, oldValue: null, newValue: "ORDER-10482" },
    ]},
    { name: "amount", type: "Double", value: "1249.00", history: [
      { timestamp: iso(1000 * 60 * 2), revision: 1, oldValue: null, newValue: "1249.00" },
    ]},
    { name: "customerId", type: "String", value: "cust_9F8231", history: [
      { timestamp: iso(1000 * 60 * 2), revision: 1, oldValue: null, newValue: "cust_9F8231" },
    ]},
  ],
  tasks: [
    { id: "T-1", name: "Manager approval", assignee: "sarah.chen", candidateGroups: ["approvers"],
      dueDate: iso(-1000 * 60 * 60 * 4), priority: 50, status: "pending" },
  ],
  trail: [
    { id: "h1", activityId: "start", activityName: "Order placed", type: "startEvent",
      startedAt: iso(1000 * 60 * 2), endedAt: iso(1000 * 60 * 2 - 40), durationMs: 40 },
    { id: "h2", activityId: "validate", activityName: "Validate order", type: "serviceTask",
      startedAt: iso(1000 * 60 * 2 - 40), endedAt: iso(1000 * 60 * 2 - 220), durationMs: 180 },
    { id: "h3", activityId: "approve", activityName: "Manager approval", type: "userTask",
      startedAt: iso(1000 * 60 * 2 - 220) },
  ],
  jobs: [],
};

// -- 2. Completed with exclusive gateway (show untaken branch) -------------

const p2: ProcessInstance = {
  id: "PI-3ba7719d",
  definitionKey: "paymentFlow",
  definitionName: "Payment Flow",
  version: 7,
  businessKey: "PAY-556021",
  status: "ended",
  startedAt: iso(1000 * 60 * 34),
  endedAt: iso(1000 * 60 * 32),
  startedBy: "billing-worker",
  deployedAt: iso(1000 * 60 * 60 * 24 * 3),
  nodes: [
    { id: "start", name: "Charge requested", type: "startEvent", x: 60, y: 200, state: "completed" },
    { id: "charge", name: "Charge card", type: "serviceTask", x: 160, y: 175, state: "completed" },
    { id: "gw", name: "amount > 100?", type: "exclusiveGateway", x: 360, y: 190, state: "completed",
      gatewayDecision: "amount = 428.50 → took \"yes\" branch" },
    { id: "receipt", name: "Send receipt", type: "serviceTask", x: 480, y: 105, state: "completed" },
    { id: "skip", name: "Log low-value txn", type: "serviceTask", x: 480, y: 275, state: "pending" },
    { id: "end", name: "Done", type: "endEvent", x: 720, y: 200, state: "completed" },
  ],
  edges: [
    { id: "f1", source: "start", target: "charge" },
    { id: "f2", source: "charge", target: "gw" },
    { id: "f3", source: "gw", target: "receipt", label: "yes", condition: "${amount > 100}", taken: true,
      waypoints: [{ x: 400, y: 210 }, { x: 400, y: 135 }, { x: 480, y: 135 }] },
    { id: "f4", source: "gw", target: "skip", label: "no", condition: "${amount <= 100}", taken: false,
      waypoints: [{ x: 400, y: 210 }, { x: 400, y: 305 }, { x: 480, y: 305 }] },
    { id: "f5", source: "receipt", target: "end",
      waypoints: [{ x: 640, y: 135 }, { x: 740, y: 135 }, { x: 740, y: 210 }] },
    { id: "f6", source: "skip", target: "end",
      waypoints: [{ x: 640, y: 305 }, { x: 740, y: 305 }, { x: 740, y: 210 }] },
  ],
  variables: [
    { name: "amount", type: "Double", value: "428.50", history: [
      { timestamp: iso(1000 * 60 * 34), revision: 1, oldValue: null, newValue: "428.50" },
    ]},
    { name: "cardLast4", type: "String", value: "4242", history: [
      { timestamp: iso(1000 * 60 * 34), revision: 1, oldValue: null, newValue: "4242" },
    ]},
    { name: "chargeId", type: "String", value: "ch_1P3nZ8XKa", history: [
      { timestamp: iso(1000 * 60 * 33), revision: 1, oldValue: null, newValue: "ch_1P3nZ8XKa" },
    ]},
  ],
  tasks: [],
  trail: [
    { id: "h1", activityId: "start", activityName: "Charge requested", type: "startEvent",
      startedAt: iso(1000 * 60 * 34), endedAt: iso(1000 * 60 * 34 - 20), durationMs: 20 },
    { id: "h2", activityId: "charge", activityName: "Charge card", type: "serviceTask",
      startedAt: iso(1000 * 60 * 34 - 20), endedAt: iso(1000 * 60 * 33), durationMs: 980 },
    { id: "h3", activityId: "gw", activityName: "amount > 100?", type: "exclusiveGateway",
      startedAt: iso(1000 * 60 * 33), endedAt: iso(1000 * 60 * 33 - 5), durationMs: 5 },
    { id: "h4", activityId: "receipt", activityName: "Send receipt", type: "serviceTask",
      startedAt: iso(1000 * 60 * 33 - 5), endedAt: iso(1000 * 60 * 32), durationMs: 995 },
    { id: "h5", activityId: "end", activityName: "Done", type: "endEvent",
      startedAt: iso(1000 * 60 * 32), endedAt: iso(1000 * 60 * 32), durationMs: 0 },
  ],
  jobs: [],
};

// -- 3. Multi-instance user task 2/3 ---------------------------------------

const p3: ProcessInstance = {
  id: "PI-c1e29d70",
  definitionKey: "documentReview",
  definitionName: "Document Review",
  version: 2,
  businessKey: "DOC-2024-Q4-338",
  status: "active",
  startedAt: iso(1000 * 60 * 60 * 6),
  startedBy: "docs.upload@svc",
  deployedAt: iso(1000 * 60 * 60 * 24 * 30),
  nodes: [
    { id: "start", name: "Doc uploaded", type: "startEvent", x: 60, y: 180, state: "completed" },
    { id: "prep", name: "Prepare packet", type: "serviceTask", x: 160, y: 155, state: "completed" },
    {
      id: "review", name: "Review document", type: "userTask", x: 360, y: 155, state: "active",
      candidateGroups: ["reviewers"], priority: 40,
      multiInstance: { total: 3, active: 1, completed: 2 },
    },
    { id: "finalize", name: "Finalize decision", type: "serviceTask", x: 580, y: 155, state: "pending" },
    { id: "end", name: "Review complete", type: "endEvent", x: 780, y: 180, state: "pending" },
  ],
  edges: [
    { id: "f1", source: "start", target: "prep" },
    { id: "f2", source: "prep", target: "review" },
    { id: "f3", source: "review", target: "finalize" },
    { id: "f4", source: "finalize", target: "end" },
  ],
  variables: [
    { name: "documentId", type: "String", value: "DOC-2024-Q4-338", history: [
      { timestamp: iso(1000 * 60 * 60 * 6), revision: 1, oldValue: null, newValue: "DOC-2024-Q4-338" },
    ]},
    { name: "reviewerCount", type: "Integer", value: "3", history: [
      { timestamp: iso(1000 * 60 * 60 * 6), revision: 1, oldValue: null, newValue: "3" },
    ]},
    { name: "approvals", type: "Integer", value: "2", history: [
      { timestamp: iso(1000 * 60 * 60 * 5), revision: 1, oldValue: null, newValue: "1" },
      { timestamp: iso(1000 * 60 * 45), revision: 2, oldValue: "1", newValue: "2" },
    ]},
  ],
  tasks: [
    { id: "T-3a", name: "Review document", assignee: "alex.morgan",
      candidateGroups: ["reviewers"], priority: 40, status: "pending",
      dueDate: iso(-1000 * 60 * 60 * 12) },
    { id: "T-3b", name: "Review document", assignee: "priya.iyer",
      candidateGroups: ["reviewers"], priority: 40, status: "completed",
      completedBy: "priya.iyer", durationMs: 1000 * 60 * 82 },
    { id: "T-3c", name: "Review document", assignee: "marco.rossi",
      candidateGroups: ["reviewers"], priority: 40, status: "completed",
      completedBy: "marco.rossi", durationMs: 1000 * 60 * 44 },
  ],
  trail: [
    { id: "h1", activityId: "start", activityName: "Doc uploaded", type: "startEvent",
      startedAt: iso(1000 * 60 * 60 * 6), endedAt: iso(1000 * 60 * 60 * 6), durationMs: 15 },
    { id: "h2", activityId: "prep", activityName: "Prepare packet", type: "serviceTask",
      startedAt: iso(1000 * 60 * 60 * 6), endedAt: iso(1000 * 60 * 60 * 5.98), durationMs: 700 },
    { id: "h3", activityId: "review", activityName: "Review document (multi-instance)", type: "userTask",
      startedAt: iso(1000 * 60 * 60 * 5.98) },
  ],
  jobs: [],
};

// -- 4. Failed with dead-letter job ----------------------------------------

const p4: ProcessInstance = {
  id: "PI-77aa0301",
  definitionKey: "invoiceProcessing",
  definitionName: "Invoice Processing",
  version: 11,
  businessKey: "INV-2024-9921",
  status: "failed",
  startedAt: iso(1000 * 60 * 18),
  startedBy: "OrderServiceTest.shouldEscalateOnTimeout",
  deployedAt: iso(1000 * 60 * 60 * 24 * 2),
  nodes: [
    { id: "start", name: "Invoice received", type: "startEvent", x: 60, y: 180, state: "completed" },
    { id: "fetch", name: "Fetch invoice data", type: "serviceTask", x: 160, y: 155, state: "completed" },
    { id: "enrich", name: "Enrich with tax info", type: "serviceTask", x: 340, y: 155, state: "completed" },
    {
      id: "post", name: "Post to SAP", type: "serviceTask", x: 520, y: 155, state: "failed",
      jobError: {
        exceptionClass: "org.springframework.web.client.HttpServerErrorException$InternalServerError",
        message: "500 Internal Server Error on POST https://sap.internal/v2/invoices : \"Connection reset by peer\"",
        retries: 0,
        stackTrace: `org.springframework.web.client.HttpServerErrorException$InternalServerError: 500 Internal Server Error
    at org.springframework.web.client.HttpServerErrorException.create(HttpServerErrorException.java:114)
    at org.springframework.web.client.DefaultResponseErrorHandler.handleError(DefaultResponseErrorHandler.java:180)
    at org.springframework.web.client.RestTemplate.handleResponse(RestTemplate.java:934)
    at org.springframework.web.client.RestTemplate.doExecute(RestTemplate.java:887)
    at com.acme.billing.SapClient.postInvoice(SapClient.java:87)
    at com.acme.billing.PostToSapDelegate.execute(PostToSapDelegate.java:34)
    at org.flowable.engine.impl.delegate.invocation.JavaDelegateInvocation.invoke(JavaDelegateInvocation.java:34)
    at org.flowable.engine.impl.bpmn.behavior.ServiceTaskJavaDelegateActivityBehavior.execute(...)
    at org.flowable.engine.impl.agenda.ContinueProcessOperation.executeSynchronousBehavior(...)
    at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)`,
      },
    },
    { id: "end", name: "Posted", type: "endEvent", x: 720, y: 180, state: "pending" },
  ],
  edges: [
    { id: "f1", source: "start", target: "fetch" },
    { id: "f2", source: "fetch", target: "enrich" },
    { id: "f3", source: "enrich", target: "post" },
    { id: "f4", source: "post", target: "end" },
  ],
  variables: [
    { name: "invoiceId", type: "String", value: "INV-2024-9921", history: [
      { timestamp: iso(1000 * 60 * 18), revision: 1, oldValue: null, newValue: "INV-2024-9921" },
    ]},
    { name: "vendor", type: "String", value: "Contoso Cloud GmbH", history: [
      { timestamp: iso(1000 * 60 * 18), revision: 1, oldValue: null, newValue: "Contoso Cloud GmbH" },
    ]},
    { name: "amount", type: "Double", value: "12480.00", history: [
      { timestamp: iso(1000 * 60 * 18), revision: 1, oldValue: null, newValue: "12480.00" },
    ]},
    { name: "sapAttempts", type: "Integer", value: "4", history: [
      { timestamp: iso(1000 * 60 * 14), revision: 1, oldValue: null, newValue: "1" },
      { timestamp: iso(1000 * 60 * 11), revision: 2, oldValue: "1", newValue: "2" },
      { timestamp: iso(1000 * 60 * 6),  revision: 3, oldValue: "2", newValue: "3" },
      { timestamp: iso(1000 * 60 * 2),  revision: 4, oldValue: "3", newValue: "4" },
    ]},
  ],
  tasks: [],
  trail: [
    { id: "h1", activityId: "start", activityName: "Invoice received", type: "startEvent",
      startedAt: iso(1000 * 60 * 18), endedAt: iso(1000 * 60 * 18), durationMs: 20 },
    { id: "h2", activityId: "fetch", activityName: "Fetch invoice data", type: "serviceTask",
      startedAt: iso(1000 * 60 * 18), endedAt: iso(1000 * 60 * 17), durationMs: 420 },
    { id: "h3", activityId: "enrich", activityName: "Enrich with tax info", type: "serviceTask",
      startedAt: iso(1000 * 60 * 17), endedAt: iso(1000 * 60 * 16), durationMs: 610 },
    { id: "h4", activityId: "post", activityName: "Post to SAP (attempt 4/4)", type: "serviceTask",
      startedAt: iso(1000 * 60 * 16) },
  ],
  jobs: [
    {
      id: "JOB-84021", type: "deadletter", activityId: "post",
      activityName: "Post to SAP", retries: 0,
      exception: "HttpServerErrorException$InternalServerError: 500 Internal Server Error",
    },
  ],
};

// -- 5. Parent with call activity + child ----------------------------------

const p6ChildId = "PI-9d3117ba";

const p5: ProcessInstance = {
  id: "PI-2f80ba14",
  definitionKey: "orderFulfillment",
  definitionName: "Order Fulfillment",
  version: 3,
  businessKey: "FUL-88121",
  status: "active",
  startedAt: iso(1000 * 60 * 22),
  startedBy: "checkout-service@svc",
  deployedAt: iso(1000 * 60 * 60 * 24 * 8),
  nodes: [
    { id: "start", name: "Order paid", type: "startEvent", x: 60, y: 180, state: "completed" },
    { id: "reserve", name: "Reserve stock", type: "serviceTask", x: 160, y: 155, state: "completed" },
    {
      id: "ship", name: "Shipping subprocess", type: "callActivity", x: 360, y: 155,
      state: "active", childInstanceId: p6ChildId,
    },
    { id: "confirm", name: "Confirm delivery", type: "userTask", x: 560, y: 155, state: "pending" },
    { id: "end", name: "Fulfilled", type: "endEvent", x: 760, y: 180, state: "pending" },
  ],
  edges: [
    { id: "f1", source: "start", target: "reserve" },
    { id: "f2", source: "reserve", target: "ship" },
    { id: "f3", source: "ship", target: "confirm" },
    { id: "f4", source: "confirm", target: "end" },
  ],
  variables: [
    { name: "orderId", type: "String", value: "ORD-88121", history: [
      { timestamp: iso(1000 * 60 * 22), revision: 1, oldValue: null, newValue: "ORD-88121" },
    ]},
    { name: "carrier", type: "String", value: "DHL", history: [
      { timestamp: iso(1000 * 60 * 20), revision: 1, oldValue: null, newValue: "DHL" },
    ]},
  ],
  tasks: [],
  trail: [
    { id: "h1", activityId: "start", activityName: "Order paid", type: "startEvent",
      startedAt: iso(1000 * 60 * 22), endedAt: iso(1000 * 60 * 22), durationMs: 10 },
    { id: "h2", activityId: "reserve", activityName: "Reserve stock", type: "serviceTask",
      startedAt: iso(1000 * 60 * 22), endedAt: iso(1000 * 60 * 21), durationMs: 340 },
    { id: "h3", activityId: "ship", activityName: "Shipping subprocess", type: "callActivity",
      startedAt: iso(1000 * 60 * 21) },
  ],
  jobs: [],
};

const p5Child: ProcessInstance = {
  id: p6ChildId,
  definitionKey: "shippingSubprocess",
  definitionName: "Shipping Subprocess",
  version: 2,
  businessKey: "FUL-88121/ship",
  status: "active",
  startedAt: iso(1000 * 60 * 21),
  startedBy: "call-activity:PI-2f80ba14",
  deployedAt: iso(1000 * 60 * 60 * 24 * 8),
  parentInstanceId: p5.id,
  nodes: [
    { id: "start", name: "Ship request", type: "startEvent", x: 60, y: 180, state: "completed" },
    { id: "label", name: "Create shipping label", type: "serviceTask", x: 180, y: 155, state: "completed" },
    { id: "pickup", name: "Schedule pickup", type: "serviceTask", x: 400, y: 155, state: "active" },
    { id: "notify", name: "Notify customer", type: "serviceTask", x: 600, y: 155, state: "pending" },
    { id: "end", name: "Shipped", type: "endEvent", x: 800, y: 180, state: "pending" },
  ],
  edges: [
    { id: "f1", source: "start", target: "label" },
    { id: "f2", source: "label", target: "pickup" },
    { id: "f3", source: "pickup", target: "notify" },
    { id: "f4", source: "notify", target: "end" },
  ],
  variables: [
    { name: "parentOrderId", type: "String", value: "ORD-88121", history: [
      { timestamp: iso(1000 * 60 * 21), revision: 1, oldValue: null, newValue: "ORD-88121" },
    ]},
    { name: "labelId", type: "String", value: "LBL-49F221", history: [
      { timestamp: iso(1000 * 60 * 20), revision: 1, oldValue: null, newValue: "LBL-49F221" },
    ]},
  ],
  tasks: [],
  trail: [
    { id: "h1", activityId: "start", activityName: "Ship request", type: "startEvent",
      startedAt: iso(1000 * 60 * 21), endedAt: iso(1000 * 60 * 21), durationMs: 8 },
    { id: "h2", activityId: "label", activityName: "Create shipping label", type: "serviceTask",
      startedAt: iso(1000 * 60 * 21), endedAt: iso(1000 * 60 * 20), durationMs: 520 },
    { id: "h3", activityId: "pickup", activityName: "Schedule pickup", type: "serviceTask",
      startedAt: iso(1000 * 60 * 20) },
  ],
  jobs: [],
};

// -- 6. Pending boundary timer + variable history --------------------------

const p6: ProcessInstance = {
  id: "PI-5501eeb2",
  definitionKey: "subscriptionRenewal",
  definitionName: "Subscription Renewal",
  version: 1,
  businessKey: "SUB-77213",
  status: "active",
  startedAt: iso(1000 * 60 * 60 * 3),
  startedBy: "scheduler@renewal",
  deployedAt: iso(1000 * 60 * 60 * 24 * 40),
  nodes: [
    { id: "start", name: "Renewal window opened", type: "startEvent", x: 60, y: 200, state: "completed" },
    { id: "prep", name: "Prepare renewal", type: "userTask", x: 180, y: 175, state: "active",
      assignee: "billing-ops", candidateGroups: ["billing"], priority: 60,
      dueDate: iso(-1000 * 60 * 60 * 8) },
    { id: "timer", name: "24h reminder", type: "boundaryTimer", x: 265, y: 230,
      state: "waiting", timerDueAt: iso(-1000 * 60 * 60 * 21), attachedTo: "prep" },
    { id: "charge", name: "Charge subscription", type: "serviceTask", x: 380, y: 175, state: "pending" },
    { id: "reminder", name: "Send reminder email", type: "serviceTask", x: 380, y: 320, state: "pending" },
    { id: "end", name: "Renewed", type: "endEvent", x: 600, y: 200, state: "pending" },
    { id: "endR", name: "Reminded", type: "endEvent", x: 600, y: 345, state: "pending" },
  ],
  edges: [
    { id: "f1", source: "start", target: "prep" },
    { id: "f2", source: "prep", target: "charge" },
    { id: "f3", source: "charge", target: "end" },
    { id: "ft", source: "timer", target: "reminder",
      waypoints: [{ x: 280, y: 260 }, { x: 280, y: 345 }, { x: 380, y: 345 }] },
    { id: "fr", source: "reminder", target: "endR" },
  ],
  variables: [
    { name: "subscriptionId", type: "String", value: "SUB-77213", history: [
      { timestamp: iso(1000 * 60 * 60 * 3), revision: 1, oldValue: null, newValue: "SUB-77213" },
    ]},
    { name: "planTier", type: "String", value: "enterprise", history: [
      { timestamp: iso(1000 * 60 * 60 * 3), revision: 1, oldValue: null, newValue: "team" },
      { timestamp: iso(1000 * 60 * 60 * 2), revision: 2, oldValue: "team", newValue: "business" },
      { timestamp: iso(1000 * 60 * 40),     revision: 3, oldValue: "business", newValue: "enterprise" },
    ]},
    { name: "renewalAmount", type: "Double", value: "4800.00", history: [
      { timestamp: iso(1000 * 60 * 60 * 3), revision: 1, oldValue: null, newValue: "480.00" },
      { timestamp: iso(1000 * 60 * 40),     revision: 2, oldValue: "480.00", newValue: "4800.00" },
    ]},
  ],
  tasks: [
    { id: "T-6", name: "Prepare renewal", assignee: "billing-ops",
      candidateGroups: ["billing"], priority: 60, status: "pending",
      dueDate: iso(-1000 * 60 * 60 * 8) },
  ],
  trail: [
    { id: "h1", activityId: "start", activityName: "Renewal window opened", type: "startEvent",
      startedAt: iso(1000 * 60 * 60 * 3), endedAt: iso(1000 * 60 * 60 * 3), durationMs: 10 },
    { id: "h2", activityId: "prep", activityName: "Prepare renewal", type: "userTask",
      startedAt: iso(1000 * 60 * 60 * 3) },
  ],
  jobs: [
    {
      id: "JOB-1120", type: "timer", activityId: "timer",
      activityName: "24h reminder timer", dueDate: iso(-1000 * 60 * 60 * 21),
    },
  ],
};

export const INSTANCES: ProcessInstance[] = [p1, p2, p3, p4, p5, p5Child, p6];

export function getInstance(id: string): ProcessInstance | undefined {
  return INSTANCES.find((p) => p.id === id);
}

export function failedJobCount(p: ProcessInstance): number {
  return p.jobs.filter((j) => j.type === "deadletter").length;
}

export function currentActivities(p: ProcessInstance): BpmnNode[] {
  return p.nodes.filter((n) => n.state === "active" || n.state === "failed");
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const s = Math.round(abs / 1000);
  if (s < 60) return diff >= 0 ? `${s}s ago` : `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return diff >= 0 ? `${m}m ago` : `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return diff >= 0 ? `${h}h ago` : `in ${h}h`;
  const d = Math.round(h / 24);
  return diff >= 0 ? `${d}d ago` : `in ${d}d`;
}

export function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  const h = m / 60;
  return `${h.toFixed(1)}h`;
}
