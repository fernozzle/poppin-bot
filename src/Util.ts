export function pick(...possibilities) {
    return possibilities[Math.random() * possibilities.length >> 0];
}
export function mapObject<T, U>(
    array:T[],
    key:  (item:T, index:number) => string,
    value:(item:T, index:number) => U,
    dest?:{}):{} {

    return array.reduce((obj, v, i) => {
        obj[key(v, i)] = value(v, i);
        return obj;
    }, dest || {});
}