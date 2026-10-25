import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, SankeyChart, HeatmapChart, ScatterChart, CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, DatasetComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, SankeyChart, HeatmapChart, ScatterChart, CustomChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, MarkAreaComponent, DatasetComponent, CanvasRenderer]);

export const PALETTE = {
  solar: '#f59e0b', battery: '#8b5cf6', grid: '#64748b', export: '#0ea5e9', curtail: '#cbd5e1', gpu: '#ef4444', flex: '#f97316',
  homes: '#14b8a6', farm: '#65a30d', land: '#a16207', site: '#475569', pos: '#16a34a', neg: '#dc2626', ink: '#1f2937', muted: '#6b7280',
};

const BASE: echarts.EChartsCoreOption = {
  textStyle: { fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif', color: '#1f2937' },
  animationDuration: 300,
};

export function EChart({ option, height = 320 }: { option: echarts.EChartsCoreOption; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const latest = useRef(option);
  latest.current = option;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.setOption({ ...BASE, ...latest.current }, { notMerge: true });
    const ro = new ResizeObserver(() => { if (!c.isDisposed()) c.resize(); });
    ro.observe(el);
    return () => { ro.disconnect(); c.dispose(); if (chart.current === c) chart.current = null; };
  }, []);
  useEffect(() => {
    const c = chart.current;
    if (c && !c.isDisposed()) c.setOption({ ...BASE, ...option }, { notMerge: true });
  }, [option]);
  return <div ref={ref} style={{ width: '100%', height }} />;
}
