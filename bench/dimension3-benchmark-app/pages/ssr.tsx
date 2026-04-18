export async function getServerSideProps() {
    const now = Date.now()
  
    const items = Array.from({ length: 2000 }, (_, i) => ({
      id: i,
      value: `server-item-${i}-${now}`,
    }))
  
    return {
      props: {
        now,
        items,
      },
    }
  }
  
  type Item = {
    id: number
    value: string
  }
  
  type Props = {
    now: number
    items: Item[]
  }
  
  export default function SSRPage({ now, items }: Props) {
    return (
      <main>
        <h1>SSR Benchmark Page</h1>
        <p>Rendered at: {now}</p>
        <ul>
          {items.map((item) => (
            <li key={item.id}>{item.value}</li>
          ))}
        </ul>
      </main>
    )
  }