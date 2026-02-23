export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select' | 'boolean' | 'textarea';
  options?: string[];
  default?: any;
  required?: boolean;
  scope?: 'adapter' | 'item'; // 增加作用域区分
}

export interface IPublisher {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  configFields: ConfigField[];
  publish(content: any, options?: any): Promise<any>;
  getItemUrl?(item: any): string;
}

export interface IStorageProvider {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  configFields: ConfigField[];
  upload(localPath: string, targetPath: string): Promise<string | null>;
}

export interface IAdapter {
  name: string;
  description?: string;
  icon?: string;
  category: string;
  configFields: ConfigField[];
  fetch(config: any): Promise<any>;
  transform(rawData: any, config?: any): any[];
  appendDateToId?: boolean;
}

export interface IAdapterConfig {
  name: string;
  category: string;
  apiUrl?: string;
  useProxy?: boolean;
  [key: string]: any;
}
