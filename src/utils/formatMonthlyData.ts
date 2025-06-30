// utils/formatMonthlyData.ts
export const formatMonthlyData = (data: any[]) => {
    return data.map(item => ({
        month: new Date(0, item._id.month - 1).toLocaleString('default', { month: 'long' }),
        year: item._id.year,
        value: item.value
    }));
};