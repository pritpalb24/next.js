export async function getStaticProps() {
    const items = Array.from({ length: 2000 }, (_, i) => ({
      id: i,
      value: `static-item-${i}`,
    }))
  
    return {
      props: {
        builtAt: new Date().toISOString(),
        items,
      },
    }
  }
  
  type Item = {
    id: number
    value: string
  }
  
  type Props = {
    builtAt: string
    items: Item[]
  }
  
  export default function SSGPage({ builtAt, items }: Props) {
    return (
      <main>
        <h1>SSG Benchmark Page</h1>
        <p>Built at: {builtAt}</p>
        <ul>
          {items.map((item) => (
            <li key={item.id}>{item.value}</li>
          ))}
        </ul>
      </main>
    )
  }