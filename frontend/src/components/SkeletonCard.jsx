export default function SkeletonCard() {
  return (
    <div className="bg-card border border-border rounded-[12px] p-4 animate-pulse border-l-4 border-l-gray-700">
      <div className="flex justify-between mb-3">
        <div className="h-5 bg-navy rounded-full w-16" />
        <div className="h-5 bg-navy rounded-full w-10" />
      </div>
      <div className="h-4 bg-navy rounded w-full mb-3" />
      <div className="h-4 bg-navy rounded w-2/3 mb-3" />
      <div className="h-3 bg-navy rounded w-1/2 mb-4" />
      <div className="flex gap-2">
        <div className="h-6 bg-navy rounded-full w-20" />
        <div className="h-6 bg-navy rounded-full w-16" />
        <div className="h-6 bg-navy rounded-full w-24" />
      </div>
    </div>
  );
}
