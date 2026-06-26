// src/components/ui/heatmap-chart-demo.tsx
import { HeatmapChart } from "@/components/ui/heatmaps";

const DemoHeatmapChart = () => {
  const width = 800;
  const height = 500;
  return (
    <div className="flex w-full h-screen justify-center items-center bg-gray-100">
      <HeatmapChart width={width} height={height} events={true} />
    </div>
  );
};

export { DemoHeatmapChart };
