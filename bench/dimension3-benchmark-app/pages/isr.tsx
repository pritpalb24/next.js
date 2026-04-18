export async function getStaticProps() {
    const now = Date.now()
  
    const items = Array.from({ length: 2000 }, (_, i) => ({
      id: i,
      value: `isr-item-${i}-${now}`,
    }))
  
    return {
      props: {
        generatedAt: now,
        items,
      },
      revalidate: 10,
    }
  }
  
  type Item = {
    id: number
    value: string
  }
  
  type Props = {
    generatedAt: number
    items: Item[]
  }
  
  export default function ISRPage({ generatedAt, items }: Props) {
    return (
      <main>
        <h1>ISR Benchmark Page</h1>
        <p>Generated at: {generatedAt}</p>
        <ul>
          {items.map((item) => (
            <li key={item.id}>{item.value}</li>
          ))}
        </ul>
      </main>
    )
  }