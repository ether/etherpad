export const determineSorting = (sortBy: string, ascending: boolean, currentSymbol: string) => {
    if (sortBy === currentSymbol) {
        return ascending ? 'sort up' : 'sort down';
    }
    return 'sort none';
}
