export function SkeletonCard({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const isLg = size === 'lg'
  return (
    <div
      className={[
        'flex-shrink-0 rounded-[2px] overflow-hidden bg-vault-card border-l-[6px] border-transparent',
        isLg ? 'w-56 h-72' : 'w-44 h-60',
      ].join(' ')}
    >
      <div className={`bg-vault-surface animate-pulse ${isLg ? 'h-56' : 'h-48'}`} />
      <div className="p-2 space-y-1.5">
        <div className="h-3 bg-vault-surface animate-pulse rounded-[2px] w-3/4" />
        <div className="h-2.5 bg-vault-surface animate-pulse rounded-[2px] w-1/2" />
      </div>
    </div>
  )
}
