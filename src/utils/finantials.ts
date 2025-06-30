// Funções auxiliares para cálculos financeiros
export interface OperationalCosts {
    fixed: {
        rent: number;
        utilities: number;
        salaries: number;
        marketing: number;
        other: number;
    };
    variable: {
        costPercentage: number; // Percentual do preço que representa custo
        averageIngredientCost: number;
        averagePackagingCost: number;
    };
}
/**
 * Calcula o CMP (Custo Médio do Produto) e CMO (Custo Médio Operacional)
 * CMP = Custo total dos produtos vendidos / Quantidade de produtos vendidos
 * CMO = Custos operacionais totais / Número total de pedidos
 */
export function calculateCMPCMO(orders: any[]): number {
    try {
        // Custos fixos mensais (exemplo - estes valores devem vir do banco de dados)
        const monthlyFixedCosts = {
            rent: 3000,        // Aluguel
            utilities: 1000,   // Água, luz, etc
            salaries: 8000,    // Salários
            marketing: 1500,   // Marketing
            other: 1000        // Outros custos fixos
        };

        const totalFixedCosts = Object.values(monthlyFixedCosts).reduce((a, b) => a + b, 0);

        // Calcular custos variáveis dos produtos
        let totalProductCost = 0;
        let totalProducts = 0;

        orders.forEach(order => {
            order.items.forEach((item: any) => {
                // Assumindo que cada item tem um campo costPrice (preço de custo)
                totalProductCost += (item.costPrice || item.price * 0.4) * item.quantity; // Se não houver costPrice, assume 40% do preço de venda
                totalProducts += item.quantity;
            });
        });

        // Calcular CMP
        const cmp = totalProducts > 0 ? totalProductCost / totalProducts : 0;

        // Calcular CMO
        const cmo = orders.length > 0 ? totalFixedCosts / orders.length : 0;

        // Retornar a média ponderada de CMP (60%) e CMO (40%)
        return Number(((cmp * 0.6 + cmo * 0.4) / 100).toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular CMP/CMO:", error);
        return 0;
    }
}

/**
 * Calcula o Ponto de Equilíbrio (Break Even Point)
 * BEP = Custos Fixos / (Preço Médio - Custo Variável Unitário)
 */
export function calculateBreakEvenPoint(totalRevenue: number, totalOrders: number): number {
    try {
        // Custos fixos mensais (exemplo - estes valores devem vir do banco de dados)
        const monthlyFixedCosts = {
            rent: 3000,
            utilities: 1000,
            salaries: 8000,
            marketing: 1500,
            other: 1000
        };

        const totalFixedCosts = Object.values(monthlyFixedCosts).reduce((a, b) => a + b, 0);

        // Calcular preço médio por pedido
        const averagePrice = totalOrders > 0 ? totalRevenue / totalOrders : 0;

        // Assumir custo variável unitário como 40% do preço médio
        const unitVariableCost = averagePrice * 0.4;

        // Calcular ponto de equilíbrio
        const breakEvenPoint = totalFixedCosts / (averagePrice - unitVariableCost);

        // Retornar o valor monetário necessário para atingir o ponto de equilíbrio
        return Number((breakEvenPoint * averagePrice).toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular Break Even Point:", error);
        return 0;
    }
}

/**
 * Calcula o Lucro Operacional
 * Lucro Operacional = Receita Total - (Custos Fixos + Custos Variáveis)
 */
export function calculateOperationalProfit(totalRevenue: number): number {
    try {
        // Custos fixos mensais
        const monthlyFixedCosts = {
            rent: 3000,
            utilities: 1000,
            salaries: 8000,
            marketing: 1500,
            other: 1000
        };

        const totalFixedCosts = Object.values(monthlyFixedCosts).reduce((a, b) => a + b, 0);

        // Assumir custos variáveis como 40% da receita total
        const variableCosts = totalRevenue * 0.4;

        // Calcular lucro operacional
        const operationalProfit = totalRevenue - (totalFixedCosts + variableCosts);

        return Number(operationalProfit.toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular Lucro Operacional:", error);
        return 0;
    }
}

/**
 * Calcula a taxa de conversão das promoções
 * Taxa de Conversão = (Pedidos com promoção / Total de visualizações da promoção) * 100
 */
export function calculatePromotionConversionRate(promotionalOrders: any[]): number {
    try {
        // Em um cenário real, você precisaria de dados de visualização das promoções
        // Isso poderia vir de um sistema de analytics ou de contadores no seu aplicativo
        const averagePromotionViews = 1000; // Exemplo: média de visualizações por promoção

        const totalPromotionalOrders = promotionalOrders.length;
        const conversionRate = (totalPromotionalOrders / averagePromotionViews) * 100;

        return Number(conversionRate.toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular taxa de conversão:", error);
        return 0;
    }
}

/**
 * Calcula o desconto médio das promoções ativas
 * Desconto Médio = Soma dos percentuais de desconto / Número de promoções
 */
export function calculateAverageDiscount(activePromotions: any[]): number {
    try {
        if (activePromotions.length === 0) return 0;

        const totalDiscount = activePromotions.reduce((sum, promotion) => {
            // Calcula o percentual de desconto para cada promoção
            const originalPrice = promotion.price;
            const promotionalPrice = promotion.promotionalPrice;
            const discountPercentage = ((originalPrice - promotionalPrice) / originalPrice) * 100;
            return sum + discountPercentage;
        }, 0);

        return Number((totalDiscount / activePromotions.length).toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular desconto médio:", error);
        return 0;
    }
}

/**
 * Calcula o ROI (Retorno sobre Investimento) das promoções
 * ROI = ((Receita - Custo) / Custo) * 100
 */
export function calculatePromotionROI(promotionalOrders: any[]): number {
    try {
        let totalRevenue = 0;
        let totalCost = 0;

        promotionalOrders.forEach(order => {
            order.items.forEach((item: any) => {
                if (item.isPromotional) {
                    totalRevenue += item.price * item.quantity;
                    // Assumindo custo como 40% do preço original
                    totalCost += (item.originalPrice * 0.4) * item.quantity;
                }
            });
        });

        // Adicionar custos de marketing (exemplo)
        const marketingCost = 1000; // Custo fixo de marketing por campanha
        totalCost += marketingCost;

        const roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;
        return Number(roi.toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular ROI:", error);
        return 0;
    }
}

/**
 * Calcula o Custo de Aquisição por Cliente em promoções
 * CAC = Total gasto em marketing e descontos / Número de novos clientes
 */
export function calculateAcquisitionCost(promotionalOrders: any[]): number {
    try {
        // Custos de marketing e promoção
        const marketingCost = 1000; // Custo fixo de marketing

        // Calcular total de descontos dados
        let totalDiscounts = 0;
        promotionalOrders.forEach(order => {
            order.items.forEach((item: any) => {
                if (item.isPromotional) {
                    const discount = (item.originalPrice - item.price) * item.quantity;
                    totalDiscounts += discount;
                }
            });
        });

        // Número de clientes únicos que usaram promoções
        const uniqueCustomers = new Set(promotionalOrders.map(order => order.userId)).size;

        const totalCost = marketingCost + totalDiscounts;
        const cac = uniqueCustomers > 0 ? totalCost / uniqueCustomers : 0;

        return Number(cac.toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular custo de aquisição:", error);
        return 0;
    }
}

/**
 * Calcula a Receita Total gerada por promoções
 * Receita Promocional = Soma do valor de todos os itens promocionais vendidos
 */
export function calculatePromotionalRevenue(promotionalOrders: any[]): number {
    try {
        let totalRevenue = 0;

        promotionalOrders.forEach(order => {
            order.items.forEach((item: any) => {
                if (item.isPromotional) {
                    totalRevenue += item.price * item.quantity;
                }
            });
        });

        return Number(totalRevenue.toFixed(2));
    } catch (error) {
        console.error("Erro ao calcular receita promocional:", error);
        return 0;
    }
}

// Função auxiliar para calcular tempo médio dos pedidos
export function calculateAverageOrderTime(orders: any[]): number {
    const completedOrders = orders.filter(order => order.status === 'completed');
    if (completedOrders.length === 0) return 0;

    const totalTime = completedOrders.reduce((sum, order) => {
        const start = new Date(order.createdAt).getTime();
        const end = new Date(order.updatedAt).getTime();
        return sum + (end - start);
    }, 0);

    return Math.round(totalTime / (completedOrders.length * 60000));
}
