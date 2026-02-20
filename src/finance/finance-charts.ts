export function generateCategoryChartUrl(
    categoryData: { category: string; amount: number }[],
    title = "Gastos por Categoria"
): string {
    if (!categoryData || categoryData.length === 0) {
        return "";
    }

    const labels = categoryData.map(c => `"${c.category}"`);
    const data = categoryData.map(c => c.amount);

    const chartConfig = {
        type: "doughnut",
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: [
                        "#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF",
                        "#FF9F40", "#E7E9ED", "#8A2BE2", "#00FA9A", "#FF1493"
                    ]
                }
            ]
        },
        options: {
            title: {
                display: true,
                text: title
            },
            plugins: {
                datalabels: {
                    display: true,
                    color: "#fff"
                }
            }
        }
    };

    const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encodedConfig}&w=500&h=300&bkg=white`;
}
