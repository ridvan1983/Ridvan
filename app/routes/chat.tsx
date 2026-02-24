import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { default as IndexRoute } from './_index';

export async function loader(_args: LoaderFunctionArgs) {
  return json({});
}

export default IndexRoute;
