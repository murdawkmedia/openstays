// OpenStays MCP server — exposes the same operations as cli/src/client.ts as
// MCP tools over stdio.
//
// Uses the SDK's low-level `Server` + `setRequestHandler(ListToolsRequestSchema
// | CallToolRequestSchema, ...)` rather than the high-level `McpServer.registerTool`
// helper: registerTool requires each input schema to be a Zod schema object,
// which would force this package to add `zod` as a second runtime dependency
// just to describe five field names. Plain JSON Schema (what MCP transmits on
// the wire anyway) needs no such dependency, so tool definitions below are
// plain objects — no extra dep beyond `@modelcontextprotocol/sdk` itself.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { ApiError, OpenStaysClient } from './client.js';
import type { OpenStaysClientOptions } from './client.js';

/** JSON-Schema-typed description of one MCP tool + how to run it against a client. */
interface ToolDefinition {
  tool: Tool;
  run: (client: OpenStaysClient, args: Record<string, unknown>) => Promise<unknown>;
}

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const bool = { type: 'boolean' } as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    tool: {
      name: 'openstays_health',
      description: 'Check that the OpenStays API is reachable and return its version.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: (client) => client.health(),
  },
  {
    tool: {
      name: 'openstays_list_properties',
      description: 'List active properties in this OpenStays deployment.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: (client) => client.listProperties(),
  },
  {
    tool: {
      name: 'openstays_list_unit_types',
      description: 'List unit types (cabins, sites, yurts, etc.) for a property.',
      inputSchema: {
        type: 'object',
        properties: { property: str },
        required: ['property'],
      },
    },
    run: (client, args) => client.listUnitTypes({ property: args.property as string }),
  },
  {
    tool: {
      name: 'openstays_list_units',
      description: 'List individual bookable units for a property.',
      inputSchema: {
        type: 'object',
        properties: { property: str },
        required: ['property'],
      },
    },
    run: (client, args) => client.listUnits({ property: args.property as string }),
  },
  {
    tool: {
      name: 'openstays_list_rate_plans',
      description: 'List rate plans for a property + unit type.',
      inputSchema: {
        type: 'object',
        properties: { property: str, unitType: str },
        required: ['property', 'unitType'],
      },
    },
    run: (client, args) =>
      client.listRatePlans({ property: args.property as string, unitType: args.unitType as string }),
  },
  {
    tool: {
      name: 'openstays_availability',
      description:
        'Get per-unit blocked/open nights for a unit type over a date range. Dates are YYYY-MM-DD.',
      inputSchema: {
        type: 'object',
        properties: { property: str, unitType: str, from: str, to: str },
        required: ['property', 'unitType', 'from', 'to'],
      },
    },
    run: (client, args) =>
      client.availability({
        property: args.property as string,
        unitType: args.unitType as string,
        from: args.from as string,
        to: args.to as string,
      }),
  },
  {
    tool: {
      name: 'openstays_tape',
      description:
        'Admin booking tape: all active bookings for a property intersecting a date window (requires a staff-scoped key).',
      inputSchema: {
        type: 'object',
        properties: { property: str, from: str, to: str },
        required: ['property', 'from', 'to'],
      },
    },
    run: (client, args) =>
      client.tape({ property: args.property as string, from: args.from as string, to: args.to as string }),
  },
  {
    tool: {
      name: 'openstays_list_bookings',
      description: 'List bookings, optionally filtered by status and/or date range.',
      inputSchema: {
        type: 'object',
        properties: {
          status: str,
          from: str,
          to: str,
          limit: num,
        },
      },
    },
    run: (client, args) =>
      client.listBookings({
        status: args.status as never,
        from: args.from as string | undefined,
        to: args.to as string | undefined,
        limit: args.limit as number | undefined,
      }),
  },
  {
    tool: {
      name: 'openstays_get_booking',
      description: 'Get one booking by its confirmation code.',
      inputSchema: {
        type: 'object',
        properties: { code: str },
        required: ['code'],
      },
    },
    run: (client, args) => client.getBooking(args.code as string),
  },
  {
    tool: {
      name: 'openstays_create_hold',
      description:
        'Create a booking hold (pre-payment) for a unit + rate plan + date range + guest. Requires a write-scoped key.',
      inputSchema: {
        type: 'object',
        properties: {
          unitId: str,
          ratePlanId: str,
          checkIn: str,
          checkOut: str,
          adults: num,
          children: num,
          guestName: str,
          guestEmail: str,
          guestPhone: str,
          marketingOptIn: bool,
          promoCode: str,
          addOns: {
            type: 'array',
            description: 'Optional paid extras to attach to the hold.',
            items: {
              type: 'object',
              properties: { addOnId: str, quantity: num },
              required: ['addOnId', 'quantity'],
            },
          },
        },
        required: ['unitId', 'ratePlanId', 'checkIn', 'checkOut', 'adults', 'guestName', 'guestEmail'],
      },
    },
    run: (client, args) =>
      client.createHold({
        unitId: args.unitId as string,
        ratePlanId: args.ratePlanId as string,
        checkIn: args.checkIn as string,
        checkOut: args.checkOut as string,
        adults: args.adults as number,
        children: (args.children as number) ?? 0,
        guest: {
          name: args.guestName as string,
          email: args.guestEmail as string,
          phone: (args.guestPhone as string) ?? '',
          marketingOptIn: Boolean(args.marketingOptIn),
        },
        addOns: (args.addOns as Array<{ addOnId: string; quantity: number }> | undefined) ?? [],
        promoCode: args.promoCode as string | undefined,
      }),
  },
  {
    tool: {
      name: 'openstays_cancel_booking',
      description:
        'Cancel a booking by confirmation code + guest email (must match the booking). Requires a write-scoped key.',
      inputSchema: {
        type: 'object',
        properties: { code: str, email: str },
        required: ['code', 'email'],
      },
    },
    run: (client, args) => client.cancelBooking(args.code as string, { email: args.email as string }),
  },
  {
    tool: {
      name: 'openstays_promo_preview',
      description: 'Preview whether a promo code is valid for a property + unit type.',
      inputSchema: {
        type: 'object',
        properties: { code: str, property: str, unitType: str },
        required: ['code', 'property', 'unitType'],
      },
    },
    run: (client, args) =>
      client.promoPreview({
        code: args.code as string,
        property: args.property as string,
        unitType: args.unitType as string,
      }),
  },
  {
    tool: {
      name: 'openstays_operations_view',
      description: 'Read a property-bounded PMS workspace such as front-desk, housekeeping, maintenance, folios, quotes, contracts, night-audit, reports, or staff search.',
      inputSchema: {
        type: 'object',
        properties: { property: str, view: str, date: str, query: str, from: str, to: str, limit: num },
        required: ['property', 'view'],
      },
    },
    run: (client, args) => client.operationsView({
      property: args.property as string,
      view: args.view as never,
      date: args.date as string | undefined,
      query: args.query as string | undefined,
      from: args.from as string | undefined,
      to: args.to as string | undefined,
      limit: args.limit as number | undefined,
    }),
  },
  {
    tool: {
      name: 'openstays_operations_action',
      description: 'Run one accepted, idempotent PMS workflow, including front-desk flags and housekeeping assignments, checklists, and inspections, through the same audited backend mutation as staff UI. Requires a write-scoped API key.',
      inputSchema: {
        type: 'object',
        properties: {
          property: str,
          action: str,
          requestId: str,
          input: { type: 'object', additionalProperties: true },
        },
        required: ['property', 'action', 'requestId', 'input'],
      },
    },
    run: (client, args) => client.operationsAction(args.action as never, {
      ...((args.input as Record<string, unknown>) ?? {}),
      property: args.property as string,
      requestId: args.requestId as string,
    }),
  },
];

/** Build an MCP Server with all OpenStays tools registered against `client`. */
export function createMcpServer(client: OpenStaysClient): Server {
  const server = new Server(
    { name: 'openstays', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((d) => d.tool),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = TOOL_DEFINITIONS.find((d) => d.tool.name === request.params.name);
    if (!definition) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      };
    }
    try {
      const result = await definition.run(client, (request.params.arguments as Record<string, unknown>) ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      if (error instanceof ApiError) {
        return {
          isError: true,
          content: [{ type: 'text', text: `[${error.code}] (HTTP ${error.status}) ${error.message}` }],
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });

  return server;
}

/** Start the MCP stdio server, reading credentials from OpenStaysClientOptions. */
export async function runMcpServer(options: OpenStaysClientOptions): Promise<void> {
  const client = new OpenStaysClient(options);
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
