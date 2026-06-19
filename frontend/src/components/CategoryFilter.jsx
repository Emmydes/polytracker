import { FILTER_PILLS } from '../utils/categories.js';

export default function CategoryFilter({ activeFilter, onFilterChange }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
      <div className="flex flex-nowrap gap-2 min-w-min">
        {FILTER_PILLS.map(({ id, label }) => {
          const active = activeFilter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onFilterChange(id)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active
                  ? 'bg-accent text-white'
                  : 'border border-border text-gray-400 hover:text-gray-200 hover:border-gray-600'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
