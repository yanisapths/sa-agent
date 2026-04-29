--- example
CREATE TABLE public.achievement_asset (
	contract_address varchar(255) NOT NULL,
	token_id serial4 NOT NULL,
	campaign_id serial4 NOT NULL,
	owner_address varchar(255) NOT NULL,
	CONSTRAINT achievement_asset_pkey PRIMARY KEY (contract_address, token_id)
);