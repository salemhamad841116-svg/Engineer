/**
 * CfgView — interactive control-flow and callgraph visualization.
 *
 * Two modes:
 * - "callgraph": functions as nodes, xrefs as edges.
 * - "blocks": basic blocks of one function as nodes, control-flow edges typed
 *   jump/true/false/call/next (/api/analysis/cfg).
 */
import React, { useMemo } from 'react';
import type { CfgResponse, FunctionOut } from '../../types/analysis';

const NODE_W = 200;
const NODE_H = 50;

const EDGE_COLORS: Record<string, string> = {
  true: '#2e7d32',
  false: '#c62828',
  jump: '#1565c0',
  call: '#6a3fb5',
  next: '#616161',
};

interface CallgraphProps {
  mode: 'callgraph';
  functions: FunctionOut[];
  onSelect?: (address: number) => void;
}

interface BlocksProps {
  mode: 'blocks';
  cfg: CfgResponse;
  onSelect?: (address: number) => void;
}

export function CfgView(props: CallgraphProps | BlocksProps) {
  const { nodes, edges } = useMemo(() => {
    if (props.mode === 'callgraph') {
      const known = new Set(props.functions.map((f) => f.address));
      const rawNodes = props.functions.map((f, idx) => ({
        id: f.address,
        label: `${f.name}\n0x${f.address.toString(16)}`,
        x: (idx % 4) * (NODE_W + 40) + 40,
        y: Math.floor(idx / 4) * (NODE_H + 50) + 40,
      }));

      const rawEdges: Array<{ src: number; dst: number; color: string }> = [];
      props.functions.forEach((f) => {
        f.xrefs_from.forEach((dst) => {
          if (known.has(dst)) {
            rawEdges.push({ src: f.address, dst, color: EDGE_COLORS.call });
          }
        });
      });
      return { nodes: rawNodes, edges: rawEdges };
    }

    // Blocks mode
    const rawNodes = props.cfg.blocks.map((b, idx) => ({
      id: b.start,
      label: `0x${b.start.toString(16)}..0x${b.end.toString(16)}\n${b.preview.slice(0, 30)}`,
      x: (idx % 3) * (NODE_W + 50) + 50,
      y: Math.floor(idx / 3) * (NODE_H + 60) + 40,
    }));

    const rawEdges = props.cfg.edges.map((e) => ({
      src: e.src,
      dst: e.dst,
      color: EDGE_COLORS[e.kind] ?? '#616161',
    }));

    return { nodes: rawNodes, edges: rawEdges };
  }, [props]);

  const width = Math.max(800, ...nodes.map((n) => n.x + NODE_W + 60));
  const height = Math.max(500, ...nodes.map((n) => n.y + NODE_H + 60));

  const nodeMap = useMemo(() => {
    const map = new Map<number, { x: number; y: number; label: string }>();
    nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [nodes]);

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: '#0f172a', borderRadius: 8, padding: 12 }}>
      <svg width={width} height={height} style={{ minWidth: '100%', minHeight: 400 }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((e, idx) => {
          const s = nodeMap.get(e.src);
          const d = nodeMap.get(e.dst);
          if (!s || !d) return null;
          const sx = s.x + NODE_W / 2;
          const sy = s.y + NODE_H;
          const dx = d.x + NODE_W / 2;
          const dy = d.y;
          return (
            <path
              key={`edge-${idx}`}
              d={`M ${sx} ${sy} C ${sx} ${(sy + dy) / 2}, ${dx} ${(sy + dy) / 2}, ${dx} ${dy}`}
              stroke={e.color}
              strokeWidth="2"
              fill="none"
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => (
          <g
            key={`node-${n.id}`}
            transform={`translate(${n.x}, ${n.y})`}
            onClick={() => props.onSelect?.(n.id)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              width={NODE_W}
              height={NODE_H}
              rx="6"
              fill="#1e293b"
              stroke="#38bdf8"
              strokeWidth="1.5"
            />
            <text
              x={NODE_W / 2}
              y={NODE_H / 2 + 4}
              fill="#f8fafc"
              fontSize="11"
              fontFamily="monospace"
              textAnchor="middle"
            >
              {n.label.split('\n')[0]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
