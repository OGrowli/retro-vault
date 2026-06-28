export function SkeletonCard({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const isLg = size === 'lg'
  return (
    <div
      className={[
        'flex-shrink-0 rounded-xl overflow-hidden bg-vault-card',
        isLg ? 'w-56 h-72' : 'w-44 h-60',
      ].join(' ')}
    >
      <div className={`bg-vault-muted animate-pulse ${isLg ? 'h-56' : 'h-48'}`} />
      <div className="p-2 space-y-1.5">
        <div className="h-3 bg-vault-muted animate-pulse rounded w-3/4" />
        <div className="h-2.5 bg-vault-muted animate-pulse rounded w-1/2" />
      </div>
    </div>
  )
}
