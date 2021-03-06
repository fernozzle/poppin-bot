// Client
var webpack = require('webpack');
var tsconfig = './client-tsconfig.json';
module.exports = {
    entry: './src/client/client.ts',
    output: {
        filename: './web/poppin.js'
    },
    devtool: 'source-map',
    externals: {
        'firebase': 'firebase',
        'd3': 'd3'
    },
    resolve: {
        // Add `.ts` and `.tsx` as a resolvable extension.
        extensions: ['', '.webpack.js', '.web.js', '.ts', '.tsx', '.js']
    },
    plugins: [
        new webpack.optimize.UglifyJsPlugin({
            sourceMap: true,
            compress: true,
            mangle: true
        })
    ],
    module: {
        loaders: [
            {
                test: /\.tsx?$/,
                loader: 'ts-loader?transpileOnly=true&configFileName=' + tsconfig
            },
            {
                test: /\.(glsl|vs|fs)$/,
                loader: 'webpack-glsl'
            }
        ]
    }
}