export default function StatsCards({ stats = [] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <div key={i} className="glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center`}>
              <stat.icon size={20} className={stat.iconColor} />
            </div>
            {stat.change && (
              <span className={`text-xs font-semibold ${stat.changePositive ? 'text-emerald-500' : 'text-red-500'}`}>
                {stat.changePositive ? '+' : '-'}{stat.change}
              </span>
            )}
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{stat.value}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{stat.label}</div>
        </div>
      ))}
    </div>
  )
}
